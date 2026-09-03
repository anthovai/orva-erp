import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_stock.view', 'orva_finance.ap.view'] },
}

const querySchema = z.object({ billId: z.string().uuid() })
const lineSchema = z.object({ id: z.string(), line_no: z.number(), description: z.string().nullable(), amount: z.string(), account_code: z.string().nullable(), received_qty: z.string() })

/** Lines of a vendor bill with how much stock was already received against each — the picker for receive-from-bill. */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const tenantId = auth.tenantId
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const lines = await withTenantRls(em, tenantId, (tem) => tem.execute(
    `select l.id, l.line_no, l.description, l.amount::text as amount, a.code as account_code,
            coalesce((select sum(c.received_qty) from orva_stock_lot_costs c where c.bill_line_id = l.id and c.deleted_at is null), 0)::text as received_qty
     from orva_ap_bill_lines l
     join orva_ap_bills b on b.id = l.bill_id and b.deleted_at is null
     left join orva_gl_accounts a on a.id = l.expense_account_id
     where l.bill_id = ?::uuid and l.tenant_id = ?::uuid and l.deleted_at is null
       and (?::uuid is null or b.organization_id = ?::uuid)
     order by l.line_no`,
    [parsed.data.billId, tenantId, organizationId, organizationId],
  ))
  return Response.json({ lines })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Stock',
  summary: 'Vendor bill lines for receiving',
  methods: {
    GET: { summary: 'Lines of one bill with quantity already received', tags: ['Orva Stock'], query: querySchema, responses: [{ status: 200, description: 'Lines.', schema: z.object({ lines: z.array(lineSchema) }) }] },
  },
}
