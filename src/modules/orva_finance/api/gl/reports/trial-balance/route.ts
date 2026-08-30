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
  periodId: z.string().uuid().optional(),
})

const rowSchema = z.object({
  account_id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  account_type: z.string(),
  total_debit: z.string(),
  total_credit: z.string(),
})

const responseSchema = z.object({
  rows: z.array(rowSchema),
  totals: z.object({
    debit: z.string(),
    credit: z.string(),
    balanced: z.boolean(),
  }),
})

/**
 * Trial balance over POSTED journals only: per-account debit/credit sums
 * (optionally restricted to one fiscal period), plus grand totals. Because
 * every posted journal is balance-checked at posting time (app + DB trigger),
 * the grand totals must always balance — the flag surfaces corruption, not a
 * normal state.
 */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const url = new URL(req.url)
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) {
    return Response.json({ error: 'Invalid query' }, { status: 400 })
  }
  const tenantId = auth.tenantId
  const organizationId = resolveActiveOrganizationId(auth)
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const rows = await withTenantRls(em, tenantId, async (tem) => {
    return (await tem.execute(
      `select a.id as account_id, a.code, a.name, a.account_type,
              coalesce(sum(l.debit), 0)::text as total_debit,
              coalesce(sum(l.credit), 0)::text as total_credit
       from orva_gl_accounts a
       left join orva_gl_journal_lines l
         on l.account_id = a.id
        and l.deleted_at is null
        and exists (
          select 1 from orva_gl_journals j
          where j.id = l.journal_id
            and j.status = 'posted'
            and j.deleted_at is null
            and (?::uuid is null or j.period_id = ?::uuid)
            and (?::uuid is null or j.organization_id = ?::uuid)
        )
       where a.deleted_at is null
         and a.tenant_id = ?::uuid
         and (?::uuid is null or a.organization_id = ?::uuid)
       group by a.id, a.code, a.name, a.account_type
       order by a.code`,
      [
        parsed.data.periodId ?? null, parsed.data.periodId ?? null,
        organizationId ?? null, organizationId ?? null,
        tenantId,
        organizationId ?? null, organizationId ?? null,
      ],
    )) as Array<z.infer<typeof rowSchema>>
  })

  let debit = 0
  let credit = 0
  for (const row of rows) {
    debit += Number(row.total_debit)
    credit += Number(row.total_credit)
  }
  return Response.json({
    rows,
    totals: {
      debit: debit.toFixed(4),
      credit: credit.toFixed(4),
      balanced: debit.toFixed(4) === credit.toFixed(4),
    },
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaFinanceTag,
  summary: 'Trial balance report',
  methods: {
    GET: {
      summary: 'Trial balance over posted journals',
      description:
        'Per-account debit/credit sums from posted journal lines, optionally restricted to one fiscal period, with grand totals.',
      tags: [orvaFinanceTag],
      query: querySchema,
      responses: [{ status: 200, description: 'Trial balance rows and totals.', schema: responseSchema }],
      errors: [{ status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) }],
    },
  },
}
