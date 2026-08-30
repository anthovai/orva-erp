import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { ApBill, ApBillLine, ApSettings, FiscalPeriod, GlJournal, GlJournalLine } from '../../../../data/entities'
import { buildBillJournalLines, computeBillTotal } from '../../../../lib/ap'
import { allocateJournalNo, checkPostable } from '../../../../lib/posting'
import { billPostSchema } from '../../../../data/validators'
import { orvaFinanceTag } from '../../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['orva_finance.ap.post'] },
}

const postResponseSchema = z.object({
  ok: z.boolean(),
  billNo: z.string().nullable().optional(),
  journalNo: z.string().nullable().optional(),
  message: z.string().optional(),
})

/**
 * Posts a vendor bill: books a GL journal (debit each expense line, credit
 * the AP control account from orva_ap_settings) and freezes the bill. The
 * journal transitions draft -> posted inside the same transaction, so the
 * orva_gl_journal_guard trigger revalidates balance/period below this code.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.sub) {
    return Response.json({ ok: false, message: 'Unauthorized' }, { status: 401 })
  }
  const parsed = billPostSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) {
    return Response.json({ ok: false, message: 'Invalid payload' }, { status: 400 })
  }
  const tenantId = auth.tenantId
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const result = await withTenantRls(em, tenantId, async (tem) => {
      const bill = await tem.findOne(ApBill, { id: parsed.data.id, deletedAt: null })
      if (!bill) throw Object.assign(new Error('Bill not found'), { status: 404 })
      if (bill.status !== 'draft') throw Object.assign(new Error('Only draft bills can be posted'), { status: 400 })
      const lines = await tem.find(ApBillLine, { billId: bill.id, deletedAt: null })
      if (lines.length === 0) throw Object.assign(new Error('Bill has no lines'), { status: 400 })
      const settings = await tem.findOne(ApSettings, { tenantId, organizationId: bill.organizationId })
      if (!settings) {
        throw Object.assign(new Error('AP control account is not configured (AP settings)'), { status: 400 })
      }
      const period = await tem.findOne(FiscalPeriod, { id: bill.periodId, deletedAt: null })
      const journalLines = buildBillJournalLines(
        lines.map((line) => ({ expenseAccountId: line.expenseAccountId, amount: line.amount, description: line.description })),
        settings.apAccountId,
      )
      const verdict = checkPostable({
        journalStatus: 'draft',
        journalDate: String(bill.billDate),
        lines: journalLines,
        period: period
          ? { status: period.status, startsOn: String(period.startsOn), endsOn: String(period.endsOn) }
          : null,
      })
      if (!verdict.ok) throw Object.assign(new Error(verdict.reason), { status: 400 })

      const now = new Date()
      const total = computeBillTotal(lines.map((line) => ({ expenseAccountId: line.expenseAccountId, amount: line.amount })))
      const journalNo = await allocateJournalNo(tem, tenantId, String(bill.organizationId))
      const journal = tem.create(GlJournal, {
        tenantId,
        organizationId: String(bill.organizationId),
        journalNo,
        status: 'draft',
        periodId: String(bill.periodId),
        journalDate: String(bill.billDate),
        currencyCode: bill.currencyCode,
        memo: `AP ${bill.billNo ?? ''} ${bill.vendorBillRef ?? ''}`.trim(),
        totalDebit: total,
        totalCredit: total,
        createdBy: auth.sub ?? null,
        createdAt: now,
        updatedAt: now,
      })
      tem.persist(journal)
      journalLines.forEach((draft, index) => {
        tem.persist(
          tem.create(GlJournalLine, {
            tenantId,
            organizationId: String(bill.organizationId),
            journalId: journal.id,
            lineNo: index + 1,
            accountId: draft.accountId,
            partyId: index < lines.length ? bill.vendorPartyId : bill.vendorPartyId,
            debit: draft.debit,
            credit: draft.credit,
            description: draft.description,
            createdAt: now,
            updatedAt: now,
          }),
        )
      })
      await tem.flush()

      // draft -> posted runs the DB guard (balance, open period, date range).
      journal.status = 'posted'
      journal.postedAt = now
      journal.postedBy = auth.sub ?? null
      bill.status = 'posted'
      bill.journalId = journal.id
      bill.postedAt = now
      bill.postedBy = auth.sub ?? null
      bill.totalAmount = total
      await tem.flush()
      return { billNo: bill.billNo ?? null, journalNo }
    })
    return Response.json({ ok: true, ...result })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    const message = error instanceof Error ? error.message : 'Posting failed'
    return Response.json({ ok: false, message }, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaFinanceTag,
  summary: 'Post a vendor bill',
  methods: {
    POST: {
      summary: 'Post a draft vendor bill to the ledger',
      description:
        'Books a balanced GL journal (debit expense lines, credit the AP control account) and freezes the bill. DB triggers enforce the same invariants.',
      tags: [orvaFinanceTag],
      requestBody: { schema: billPostSchema },
      responses: [{ status: 200, description: 'Bill posted with its journal number.', schema: postResponseSchema }],
      errors: [
        { status: 400, description: 'Not postable (no lines, AP account unset, closed period, not a draft)', schema: postResponseSchema },
        { status: 401, description: 'Authentication required', schema: postResponseSchema },
        { status: 404, description: 'Bill not found', schema: postResponseSchema },
      ],
    },
  },
}
