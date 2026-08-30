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

const invoiceRowSchema = z.object({
  id: z.string().uuid(),
  invoice_number: z.string(),
  status: z.string().nullable(),
  issue_date: z.string().nullable(),
  currency_code: z.string(),
  grand_total_gross_amount: z.string(),
  tax_total_amount: z.string(),
})

const responseSchema = z.object({ items: z.array(invoiceRowSchema) })

/**
 * Sales invoices (core `sales` module) that have not been booked into the GL
 * yet — i.e. no orva_ar_invoice_postings row. Cancelled/voided invoices and
 * zero-total invoices are excluded.
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
      `select i.id, i.invoice_number, i.status,
              to_char(i.issue_date, 'YYYY-MM-DD') as issue_date,
              i.currency_code,
              i.grand_total_gross_amount::text,
              i.tax_total_amount::text
       from sales_invoices i
       where i.deleted_at is null
         and i.tenant_id = ?::uuid
         and (?::uuid is null or i.organization_id = ?::uuid)
         and i.grand_total_gross_amount > 0
         and coalesce(i.status, '') not in ('cancelled', 'canceled', 'void', 'voided')
         and not exists (
           select 1 from orva_ar_invoice_postings p
           where p.invoice_id = i.id and p.tenant_id = i.tenant_id
         )
       order by i.issue_date nulls last, i.created_at
       limit 200`,
      [tenantId, organizationId ?? null, organizationId ?? null],
    )) as Array<z.infer<typeof invoiceRowSchema>>,
  )

  return Response.json({ items })
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaFinanceTag,
  summary: 'Unposted sales invoices',
  methods: {
    GET: {
      summary: 'Sales invoices not yet booked into the GL',
      tags: [orvaFinanceTag],
      responses: [{ status: 200, description: 'Unposted invoices.', schema: responseSchema }],
      errors: [{ status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) }],
    },
  },
}
