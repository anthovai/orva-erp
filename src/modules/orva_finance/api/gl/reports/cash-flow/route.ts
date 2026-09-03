import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { buildCashFlow } from '../../../../lib/cashflow'
import type { AccountSums } from '../../../../lib/statements'
import { orvaFinanceTag } from '../../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_finance.gl.view'] },
}

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

const lineSchema = z.object({ code: z.string(), name: z.string(), amount: z.string() })
const responseSchema = z.object({
  from: z.string(),
  to: z.string(),
  netProfit: z.string(),
  operating: z.array(lineSchema),
  investing: z.array(lineSchema),
  financing: z.array(lineSchema),
  totalOperating: z.string(),
  totalInvesting: z.string(),
  totalFinancing: z.string(),
  netChange: z.string(),
  openingCash: z.string(),
  closingCash: z.string(),
  reconciled: z.boolean(),
})

/** งบกระแสเงินสด (indirect method) between two dates, tied to the cash accounts. */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const tenantId = auth.tenantId
  const organizationId = resolveActiveOrganizationId(auth)
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const { from, to } = parsed.data

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const sumsThrough = async (tem: EntityManager, endExclusive: string | null, endInclusive: string | null): Promise<AccountSums[]> =>
    (await tem.execute(
      `select a.id as "accountId", a.code, a.name, a.account_type as "accountType",
              coalesce(sum(x.debit), 0)::text as debit, coalesce(sum(x.credit), 0)::text as credit
       from orva_gl_accounts a
       left join (
         -- the date window must filter the JOINED lines, not just the journal
         -- row, or a left join keeps every line and both sums collapse to the
         -- same totals
         select l.account_id, l.debit, l.credit
         from orva_gl_journal_lines l
         join orva_gl_journals j on j.id = l.journal_id and j.status = 'posted' and j.deleted_at is null
         where l.deleted_at is null and l.tenant_id = ?::uuid
           and (?::date is null or j.journal_date < ?::date)
           and (?::date is null or j.journal_date <= ?::date)
       ) x on x.account_id = a.id
       where a.tenant_id = ?::uuid and a.deleted_at is null
         and (?::uuid is null or a.organization_id = ?::uuid)
       group by a.id, a.code, a.name, a.account_type`,
      [tenantId, endExclusive, endExclusive, endInclusive, endInclusive, tenantId, organizationId ?? null, organizationId ?? null],
    )) as AccountSums[]

  const result = await withTenantRls(em, tenantId, async (tem) => {
    const opening = (await sumsThrough(tem, from, null)).filter((r) => Number(r.debit) || Number(r.credit))
    const closing = (await sumsThrough(tem, null, to)).filter((r) => Number(r.debit) || Number(r.credit))
    return { from, to, ...buildCashFlow(opening, closing) }
  })
  return Response.json(result)
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaFinanceTag,
  summary: 'Cash flow statement (งบกระแสเงินสด)',
  methods: {
    GET: {
      summary: 'Indirect-method cash flow between two dates, reconciled to the cash accounts',
      tags: [orvaFinanceTag],
      query: querySchema,
      responses: [{ status: 200, description: 'Cash flow statement.', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid query', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
