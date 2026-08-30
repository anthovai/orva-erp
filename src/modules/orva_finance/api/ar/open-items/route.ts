import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { orvaFinanceTag } from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_finance.ar.view'] },
}

const openItemSchema = z.object({
  invoice_id: z.string().uuid(),
  invoice_number: z.string(),
  posted_amount: z.string(),
  received_amount: z.string(),
  remaining_amount: z.string(),
  posted_on: z.string().nullable(),
})

const responseSchema = z.object({ items: z.array(openItemSchema) })

/**
 * AR open items: invoices booked into the GL (orva_ar_invoice_postings)
 * whose posted amount exceeds the sum of POSTED receipt allocations.
 * Remaining balances are derived — the posting record stays immutable.
 */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const tenantId = auth.tenantId
  const organizationId = resolveActiveOrganizationId(auth)
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const items = await withTenantRls(em, tenantId, async (tem) =>
    (await tem.execute(
      `select p.invoice_id, p.invoice_number,
              p.amount::text as posted_amount,
              coalesce(r.received, 0)::text as received_amount,
              (p.amount - coalesce(r.received, 0))::text as remaining_amount,
              to_char(p.created_at, 'YYYY-MM-DD') as posted_on
       from orva_ar_invoice_postings p
       left join (
         select a.invoice_id, sum(a.amount) as received
         from orva_ar_receipt_allocations a
         join orva_ar_receipts rc on rc.id = a.receipt_id and rc.status = 'posted' and rc.deleted_at is null
         where a.deleted_at is null
         group by a.invoice_id
       ) r on r.invoice_id = p.invoice_id
       where p.tenant_id = ?::uuid
         and (?::uuid is null or p.organization_id = ?::uuid)
         and p.amount - coalesce(r.received, 0) > 0.00005
       order by p.created_at
       limit 200`,
      [tenantId, organizationId ?? null, organizationId ?? null],
    )) as Array<z.infer<typeof openItemSchema>>,
  )

  return Response.json({ items })
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaFinanceTag,
  summary: 'AR open items',
  methods: {
    GET: {
      summary: 'GL-posted sales invoices with a remaining receivable balance',
      tags: [orvaFinanceTag],
      responses: [{ status: 200, description: 'Open AR items with derived remaining balances.', schema: responseSchema }],
      errors: [{ status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) }],
    },
  },
}
