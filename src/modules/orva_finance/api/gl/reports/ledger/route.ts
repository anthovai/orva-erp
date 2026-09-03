import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { orvaFinanceTag } from '../../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_finance.gl.view'] },
}

const querySchema = z.object({
  accountId: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

const lineSchema = z.object({
  journal_line_id: z.string().uuid(),
  journal_id: z.string().uuid(),
  journal_no: z.string().nullable(),
  journal_date: z.string(),
  journal_kind: z.string(),
  memo: z.string().nullable(),
  description: z.string().nullable(),
  debit: z.string(),
  credit: z.string(),
  balance: z.string(),
})

const responseSchema = z.object({
  account: z.object({ id: z.string().uuid(), code: z.string(), name: z.string(), account_type: z.string() }),
  openingBalance: z.string(),
  lines: z.array(lineSchema),
  closingBalance: z.string(),
  totalDebit: z.string(),
  totalCredit: z.string(),
})

const CREDIT_NORMAL = new Set(['liability', 'equity', 'income'])

/**
 * บัญชีแยกประเภท — one account's posted lines in a date range with an opening
 * balance and a running balance (debit-normal for assets/expenses, credit-
 * normal otherwise). For a cash/bank account this is the สมุดเงินสด/ธนาคาร.
 */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const tenantId = auth.tenantId
  const organizationId = resolveActiveOrganizationId(auth)
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const { accountId, from, to } = parsed.data

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const result = await withTenantRls(em, tenantId, async (tem) => {
    const accounts = (await tem.execute(
      `select id, code, name, account_type from orva_gl_accounts
       where id = ?::uuid and tenant_id = ?::uuid and deleted_at is null`,
      [accountId, tenantId],
    )) as Array<{ id: string; code: string; name: string; account_type: string }>
    const account = accounts[0]
    if (!account) return null
    const sign = CREDIT_NORMAL.has(account.account_type) ? -1 : 1

    const opening = (await tem.execute(
      `select coalesce(sum(l.debit), 0) as debit, coalesce(sum(l.credit), 0) as credit
       from orva_gl_journal_lines l
       join orva_gl_journals j on j.id = l.journal_id and j.status = 'posted' and j.deleted_at is null
       where l.account_id = ?::uuid and l.tenant_id = ?::uuid and l.deleted_at is null
         and (?::uuid is null or j.organization_id = ?::uuid)
         and j.journal_date < ?::date`,
      [accountId, tenantId, organizationId ?? null, organizationId ?? null, from],
    )) as Array<{ debit: string; credit: string }>
    let running = sign * (Number(opening[0]?.debit ?? 0) - Number(opening[0]?.credit ?? 0))
    const openingBalance = running

    const rows = (await tem.execute(
      `select l.id as journal_line_id, j.id as journal_id, j.journal_no, to_char(j.journal_date, 'YYYY-MM-DD') as journal_date,
              j.journal_kind, j.memo, l.description, l.debit::text, l.credit::text
       from orva_gl_journal_lines l
       join orva_gl_journals j on j.id = l.journal_id and j.status = 'posted' and j.deleted_at is null
       where l.account_id = ?::uuid and l.tenant_id = ?::uuid and l.deleted_at is null
         and (?::uuid is null or j.organization_id = ?::uuid)
         and j.journal_date between ?::date and ?::date
       order by j.journal_date, j.journal_no, l.line_no`,
      [accountId, tenantId, organizationId ?? null, organizationId ?? null, from, to],
    )) as Array<Omit<z.infer<typeof lineSchema>, 'balance'>>

    let totalDebit = 0
    let totalCredit = 0
    const lines = rows.map((row) => {
      const d = Number(row.debit)
      const c = Number(row.credit)
      totalDebit += d
      totalCredit += c
      running += sign * (d - c)
      return { ...row, debit: d.toFixed(4), credit: c.toFixed(4), balance: running.toFixed(4) }
    })
    return {
      account,
      openingBalance: openingBalance.toFixed(4),
      lines,
      closingBalance: running.toFixed(4),
      totalDebit: totalDebit.toFixed(4),
      totalCredit: totalCredit.toFixed(4),
    }
  })
  if (!result) return Response.json({ error: 'Account not found' }, { status: 404 })
  return Response.json(result)
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaFinanceTag,
  summary: 'Account ledger (บัญชีแยกประเภท)',
  methods: {
    GET: {
      summary: 'Posted lines of one account in a date range with opening and running balances',
      tags: [orvaFinanceTag],
      query: querySchema,
      responses: [{ status: 200, description: 'Ledger for the account.', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid query', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Account not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
