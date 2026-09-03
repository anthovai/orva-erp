import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { orvaFinanceTag } from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_finance.gl.view'] },
}

const querySchema = z.object({
  /** YYYY-MM — the VAT month (ภ.พ.30 is filed monthly) */
  month: z.string().regex(/^\d{4}-\d{2}$/),
})

const salesRowSchema = z.object({
  date: z.string(),
  document_no: z.string(),
  customer_name: z.string().nullable(),
  customer_tax_id: z.string().nullable(),
  customer_branch: z.string().nullable(),
  base: z.string(),
  vat: z.string(),
  total: z.string(),
})

const purchaseRowSchema = z.object({
  date: z.string(),
  document_no: z.string(),
  vendor_ref: z.string().nullable(),
  vendor_name: z.string().nullable(),
  vendor_tax_id: z.string().nullable(),
  base: z.string(),
  vat: z.string(),
  total: z.string(),
})

const responseSchema = z.object({
  month: z.string(),
  sales: z.array(salesRowSchema),
  purchases: z.array(purchaseRowSchema),
  summary: z.object({
    outputBase: z.string(),
    outputVat: z.string(),
    inputBase: z.string(),
    inputVat: z.string(),
    /** positive = ภาษีที่ต้องชำระ, negative = ภาษีชำระเกิน (ยกไป) */
    netPayable: z.string(),
  }),
})

/**
 * รายงานภาษีขาย / ภาษีซื้อ and the ภ.พ.30 summary for one month.
 *
 * Tax point for this service business is the RECEIPT: the tax invoice is the
 * combined ใบกำกับภาษี/ใบเสร็จ issued when the customer pays, so a sales
 * invoice enters the output-VAT report in the month of its paidDate (set by
 * orva_documents record-payment). Purchases are posted vendor bills carrying
 * input VAT, by bill date.
 */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const tenantId = auth.tenantId
  const organizationId = resolveActiveOrganizationId(auth)
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const { month } = parsed.data

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const result = await withTenantRls(em, tenantId, async (tem) => {
    const sales = (await tem.execute(
      `select i.metadata->>'paidDate' as date,
              i.invoice_number as document_no,
              coalesce(i.metadata->'customerSnapshot'->'customer'->>'displayName',
                       i.metadata->'customerSnapshot'->>'displayName') as customer_name,
              (select v.value_text from custom_field_values v
                 where v.field_key = 'th_tax_id' and v.deleted_at is null and v.tenant_id = i.tenant_id
                   and v.record_id in (
                     i.metadata->>'customerEntityId',
                     (select c.id::text from customer_companies c
                        where c.entity_id::text = i.metadata->>'customerEntityId' limit 1)
                   ) limit 1) as customer_tax_id,
              (select v.value_text from custom_field_values v
                 where v.field_key = 'th_branch_code' and v.deleted_at is null and v.tenant_id = i.tenant_id
                   and v.record_id in (
                     i.metadata->>'customerEntityId',
                     (select c.id::text from customer_companies c
                        where c.entity_id::text = i.metadata->>'customerEntityId' limit 1)
                   ) limit 1) as customer_branch,
              i.grand_total_net_amount::text as base,
              i.tax_total_amount::text as vat,
              i.grand_total_gross_amount::text as total
       from sales_invoices i
       where i.deleted_at is null and i.tenant_id = ?::uuid
         and (?::uuid is null or i.organization_id = ?::uuid)
         and i.tax_total_amount > 0
         and left(i.metadata->>'paidDate', 7) = ?
       order by i.metadata->>'paidDate', i.invoice_number`,
      [tenantId, organizationId ?? null, organizationId ?? null, month],
    )) as Array<z.infer<typeof salesRowSchema>>

    const purchases = (await tem.execute(
      `select to_char(b.bill_date, 'YYYY-MM-DD') as date,
              coalesce(b.bill_no, '') as document_no,
              b.vendor_bill_ref as vendor_ref,
              p.display_name as vendor_name,
              p.tax_id as vendor_tax_id,
              (b.total_amount - b.tax_amount)::text as base,
              b.tax_amount::text as vat,
              b.total_amount::text as total
       from orva_ap_bills b
       left join orva_parties p on p.id = b.vendor_party_id
       where b.deleted_at is null and b.status = 'posted' and b.tenant_id = ?::uuid
         and (?::uuid is null or b.organization_id = ?::uuid)
         and b.tax_amount > 0
         and to_char(b.bill_date, 'YYYY-MM') = ?
       order by b.bill_date, b.bill_no`,
      [tenantId, organizationId ?? null, organizationId ?? null, month],
    )) as Array<z.infer<typeof purchaseRowSchema>>

    const sum = (rows: Array<{ base: string; vat: string }>) =>
      rows.reduce((acc, r) => ({ base: acc.base + Number(r.base), vat: acc.vat + Number(r.vat) }), { base: 0, vat: 0 })
    const out = sum(sales)
    const inp = sum(purchases)
    return {
      month,
      sales,
      purchases,
      summary: {
        outputBase: out.base.toFixed(2),
        outputVat: out.vat.toFixed(2),
        inputBase: inp.base.toFixed(2),
        inputVat: inp.vat.toFixed(2),
        netPayable: (out.vat - inp.vat).toFixed(2),
      },
    }
  })
  return Response.json(result)
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaFinanceTag,
  summary: 'VAT reports (รายงานภาษีขาย/ภาษีซื้อ, ภ.พ.30)',
  methods: {
    GET: {
      summary: 'Output and input VAT registers for a month with the ภ.พ.30 net',
      tags: [orvaFinanceTag],
      query: querySchema,
      responses: [{ status: 200, description: 'VAT registers and summary.', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid query', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
