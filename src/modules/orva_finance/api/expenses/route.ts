import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { ApSettings, FiscalPeriod, GlJournal, GlJournalLine } from '../../data/entities'
import { expenseCreateSchema, expenseListSchema } from '../../data/validators'
import { buildExpenseJournalLines, splitInclusiveReceipt } from '../../lib/ap'
import { allocateJournalNo, checkPostable } from '../../lib/posting'
import { orvaFinanceTag } from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_finance.ap.view'] },
  POST: { requireAuth: true, requireFeatures: ['orva_finance.ap.manage', 'orva_finance.gl.post'] },
}

const expenseSchema = z.object({
  journalId: z.string(),
  journalNo: z.string().nullable(),
  paidOn: z.string(),
  payee: z.string().nullable(),
  documentNo: z.string().nullable(),
  memo: z.string().nullable(),
  net: z.string(),
  vat: z.string(),
  wht: z.string(),
  paid: z.string(),
  expenseAccount: z.string().nullable(),
})

/**
 * Expenses recorded through this screen — recognised by the journal memo tag,
 * so no extra table is needed: the journal IS the record, exactly as an
 * accountant would file the receipt.
 */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = expenseListSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const tenantId = auth.tenantId
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const items = await withTenantRls(em, tenantId, (tem) => tem.execute(
    `select j.id as journal_id, j.journal_no, to_char(j.journal_date, 'YYYY-MM-DD') as paid_on, j.memo,
            j.metadata->>'payee' as payee, j.metadata->>'documentNo' as document_no,
            coalesce((select sum(l.debit) from orva_gl_journal_lines l
                        join orva_gl_accounts a on a.id = l.account_id
                       where l.journal_id = j.id and l.deleted_at is null and a.account_type = 'expense'), 0)::text as net,
            coalesce((select sum(l.debit) from orva_gl_journal_lines l
                        join orva_gl_accounts a on a.id = l.account_id
                       where l.journal_id = j.id and l.deleted_at is null and a.account_type = 'asset' and a.code like '13%'), 0)::text as vat,
            coalesce((select sum(l.credit) from orva_gl_journal_lines l
                        join orva_gl_accounts a on a.id = l.account_id
                       where l.journal_id = j.id and l.deleted_at is null and a.account_type = 'liability'), 0)::text as wht,
            coalesce((select sum(l.credit) from orva_gl_journal_lines l
                        join orva_gl_accounts a on a.id = l.account_id
                       where l.journal_id = j.id and l.deleted_at is null and a.account_type = 'asset' and a.code like '10%'), 0)::text as paid,
            (select a.code || ' ' || a.name from orva_gl_journal_lines l
               join orva_gl_accounts a on a.id = l.account_id
              where l.journal_id = j.id and l.deleted_at is null and a.account_type = 'expense' limit 1) as expense_account
     from orva_gl_journals j
     where j.deleted_at is null and j.tenant_id = ?::uuid and j.organization_id = ?::uuid
       and j.metadata->>'source' = 'orva_finance.expense'
       and (?::text is null or to_char(j.journal_date, 'YYYY-MM') = ?::text)
     order by j.journal_date desc, j.journal_no desc
     limit ?`,
    [tenantId, organizationId, parsed.data.month ?? null, parsed.data.month ?? null, parsed.data.pageSize],
  )) as Array<Record<string, string | null>>

  return Response.json({
    items: items.map((r) => ({
      journalId: r.journal_id, journalNo: r.journal_no, paidOn: r.paid_on, payee: r.payee,
      documentNo: r.document_no, memo: r.memo, net: r.net, vat: r.vat, wht: r.wht, paid: r.paid,
      expenseAccount: r.expense_account,
    })),
  })
}

/**
 * Records an expense paid from cash/bank and posts it in one step: the
 * receipt's VAT lands in ภาษีซื้อ (so ภ.พ.30 picks it up), any withholding in
 * ภาษีหัก ณ ที่จ่ายค้างนำส่ง (so ภ.ง.ด.3/53 does), and the cash out on the
 * chosen account. The receipt image is attached client-side to the journal.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.sub) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = expenseCreateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const input = parsed.data
  const tenantId = auth.tenantId
  const userId = auth.sub
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const result = await withTenantRls(em, tenantId, async (tem) => {
      const settings = await tem.findOne(ApSettings, { tenantId, organizationId })
      const split = input.vatMode === 'inclusive'
        ? splitInclusiveReceipt(input.amount)
        : { net: input.amount, vat: input.vatMode === 'exclusive' ? input.vatAmount : 0 }
      if (split.vat > 0 && !settings?.inputVatAccountId) {
        throw Object.assign(new Error('ยังไม่ได้ตั้งค่าบัญชีภาษีซื้อ — ตั้งได้ที่ตั้งค่า AP'), { status: 400 })
      }
      if (input.whtAmount > 0 && !settings?.whtPayableAccountId) {
        throw Object.assign(new Error('ยังไม่ได้ตั้งค่าบัญชีภาษีหัก ณ ที่จ่ายค้างนำส่ง'), { status: 400 })
      }
      const period = await tem.findOne(FiscalPeriod, { code: input.paidOn.slice(0, 7), tenantId, organizationId, deletedAt: null })
      if (!period) throw Object.assign(new Error(`ไม่มีงวดบัญชี ${input.paidOn.slice(0, 7)}`), { status: 400 })
      if (period.status !== 'open') throw Object.assign(new Error('งวดบัญชีปิดแล้ว'), { status: 400 })

      const lines = buildExpenseJournalLines({
        expenseAccountId: input.expenseAccountId,
        net: split.net,
        vat: split.vat,
        wht: input.whtAmount,
        cashAccountId: input.cashAccountId,
        inputVatAccountId: settings?.inputVatAccountId ?? null,
        whtPayableAccountId: settings?.whtPayableAccountId ?? null,
        description: input.memo ?? input.payee,
      })
      const verdict = checkPostable({
        journalStatus: 'draft', journalDate: input.paidOn, lines,
        period: { status: period.status, startsOn: String(period.startsOn), endsOn: String(period.endsOn) },
      })
      if (!verdict.ok) throw Object.assign(new Error(verdict.reason), { status: 400 })

      const total = lines.reduce((s, l) => s + Number(l.debit), 0)
      const now = new Date()
      const journalNo = await allocateJournalNo(tem, tenantId, organizationId)
      const journal = tem.create(GlJournal, {
        tenantId, organizationId, journalNo, status: 'draft', journalKind: 'standard',
        periodId: period.id, journalDate: input.paidOn, currencyCode: 'THB',
        memo: `ค่าใช้จ่าย ${input.payee}${input.documentNo ? ` (${input.documentNo})` : ''}${input.memo ? ` — ${input.memo}` : ''}`.slice(0, 500),
        totalDebit: total.toFixed(4), totalCredit: total.toFixed(4),
        createdBy: userId, createdAt: now, updatedAt: now,
      })
      tem.persist(journal)
      await tem.flush()
      lines.forEach((draft, index) => {
        tem.persist(tem.create(GlJournalLine, {
          tenantId, organizationId, journalId: journal.id, lineNo: index + 1,
          accountId: draft.accountId, partyId: null, debit: draft.debit, credit: draft.credit,
          description: draft.description ?? null, createdAt: now, updatedAt: now,
        }))
      })
      await tem.flush()
      // metadata identifies the screen that created it and feeds the VAT/WHT registers
      await tem.execute(
        `update orva_gl_journals set metadata = coalesce(metadata, '{}'::jsonb) || ?::jsonb, status = 'posted', posted_at = now(), posted_by = ?::uuid, updated_at = now()
         where id = ?::uuid and tenant_id = ?::uuid`,
        [JSON.stringify({
          source: 'orva_finance.expense', payee: input.payee, payeeTaxId: input.payeeTaxId ?? null,
          documentNo: input.documentNo ?? null, net: split.net, vat: split.vat,
          wht: input.whtAmount, whtRate: input.whtRate ?? null, vatMode: input.vatMode,
        }), userId, journal.id, tenantId],
      )
      return { journalId: journal.id, journalNo, net: split.net, vat: split.vat, wht: input.whtAmount, paid: Math.round((split.net + split.vat - input.whtAmount) * 100) / 100 }
    })
    return Response.json({ ok: true, ...result })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json({ error: error instanceof Error ? error.message : 'Expense posting failed' }, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaFinanceTag,
  summary: 'Expenses paid from cash/bank (ค่าใช้จ่ายจ่ายสด)',
  methods: {
    GET: { summary: 'Expenses recorded through this screen', tags: [orvaFinanceTag], query: expenseListSchema, responses: [{ status: 200, description: 'Expenses.', schema: z.object({ items: z.array(expenseSchema) }) }] },
    POST: { summary: 'Record and post an expense (input VAT and withholding included)', tags: [orvaFinanceTag], requestBody: { schema: expenseCreateSchema }, responses: [{ status: 200, description: 'Posted.', schema: z.object({ ok: z.boolean(), journalId: z.string(), journalNo: z.string() }) }] },
  },
}
