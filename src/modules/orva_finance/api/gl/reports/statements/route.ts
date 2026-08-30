import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { buildBalanceSheet, buildProfitAndLoss, type AccountSums } from '../../../../lib/statements'
import { orvaFinanceTag } from '../../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_finance.gl.view'] },
}

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

const statementRowSchema = z.object({
  accountId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  balance: z.string(),
})

const responseSchema = z.object({
  pl: z.object({
    income: z.array(statementRowSchema),
    expense: z.array(statementRowSchema),
    totalIncome: z.string(),
    totalExpense: z.string(),
    netProfit: z.string(),
  }),
  balanceSheet: z.object({
    asset: z.array(statementRowSchema),
    liability: z.array(statementRowSchema),
    equity: z.array(statementRowSchema),
    currentEarnings: z.string(),
    totalAssets: z.string(),
    totalLiabilities: z.string(),
    totalEquity: z.string(),
    totalLiabilitiesAndEquity: z.string(),
    balanced: z.boolean(),
  }),
})

/**
 * Financial statements over POSTED journals.
 * - P&L: income/expense sums within [from, to] (either bound optional).
 * - Balance sheet: cumulative sums up to and including `to` (or everything).
 * The balance sheet's equity carries computed current earnings, so
 * Assets = Liabilities + Equity holds without closing entries.
 */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const { from, to } = parsed.data
  const tenantId = auth.tenantId
  const organizationId = resolveActiveOrganizationId(auth)
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const sumsQuery = (useFrom: boolean) => `
    select a.id as account_id, a.code, a.name, a.account_type,
           coalesce(sum(l.debit), 0)::text as debit,
           coalesce(sum(l.credit), 0)::text as credit
    from orva_gl_accounts a
    left join orva_gl_journal_lines l
      on l.account_id = a.id
     and l.deleted_at is null
     and exists (
       select 1 from orva_gl_journals j
       where j.id = l.journal_id
         and j.status = 'posted'
         and j.deleted_at is null
         ${useFrom ? `and (?::date is null or j.journal_date >= ?::date)` : ''}
         and (?::date is null or j.journal_date <= ?::date)
         and (?::uuid is null or j.organization_id = ?::uuid)
     )
    where a.deleted_at is null
      and a.tenant_id = ?::uuid
      and (?::uuid is null or a.organization_id = ?::uuid)
    group by a.id, a.code, a.name, a.account_type`

  const toRows = (raw: Array<Record<string, unknown>>): AccountSums[] =>
    raw.map((row) => ({
      accountId: String(row.account_id),
      code: String(row.code),
      name: String(row.name),
      accountType: String(row.account_type),
      debit: String(row.debit),
      credit: String(row.credit),
    }))

  const { rangeSums, cumulativeSums } = await withTenantRls(em, tenantId, async (tem) => {
    const range = toRows(
      (await tem.execute(sumsQuery(true), [
        from ?? null, from ?? null,
        to ?? null, to ?? null,
        organizationId ?? null, organizationId ?? null,
        tenantId,
        organizationId ?? null, organizationId ?? null,
      ])) as Array<Record<string, unknown>>,
    )
    const cumulative = toRows(
      (await tem.execute(sumsQuery(false), [
        to ?? null, to ?? null,
        organizationId ?? null, organizationId ?? null,
        tenantId,
        organizationId ?? null, organizationId ?? null,
      ])) as Array<Record<string, unknown>>,
    )
    return { rangeSums: range, cumulativeSums: cumulative }
  })

  return Response.json({
    pl: buildProfitAndLoss(rangeSums),
    balanceSheet: buildBalanceSheet(cumulativeSums),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaFinanceTag,
  summary: 'Financial statements',
  methods: {
    GET: {
      summary: 'Profit & loss and balance sheet over posted journals',
      description:
        'P&L sums income/expense within [from, to]; the balance sheet is cumulative up to `to` with computed current earnings in equity.',
      tags: [orvaFinanceTag],
      query: querySchema,
      responses: [{ status: 200, description: 'Statements.', schema: responseSchema }],
      errors: [{ status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) }],
    },
  },
}
