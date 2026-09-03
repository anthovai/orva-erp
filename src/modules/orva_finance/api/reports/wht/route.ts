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
  month: z.string().regex(/^\d{4}-\d{2}$/),
})

const withheldByUsSchema = z.object({
  date: z.string(),
  payment_no: z.string().nullable(),
  cert_no: z.string().nullable(),
  vendor_name: z.string().nullable(),
  vendor_tax_id: z.string().nullable(),
  income_type: z.string().nullable(),
  rate: z.string().nullable(),
  /** amount paid before withholding (the WHT base) */
  base: z.string(),
  wht: z.string(),
})

const withheldFromUsSchema = z.object({
  date: z.string(),
  receipt_no: z.string().nullable(),
  invoice_no: z.string().nullable(),
  customer_name: z.string().nullable(),
  rate: z.string().nullable(),
  base: z.string(),
  wht: z.string(),
})

const responseSchema = z.object({
  month: z.string(),
  /** ภ.ง.ด.3/53 — tax WE withheld from vendors, to remit by the 7th of next month */
  withheldByUs: z.array(withheldByUsSchema),
  /** ภาษีถูกหัก ณ ที่จ่าย — tax customers withheld from us (credit against CIT) */
  withheldFromUs: z.array(withheldFromUsSchema),
  summary: z.object({ payable: z.string(), receivable: z.string() }),
})

/**
 * Withholding-tax registers for a month: what we withheld from vendors on
 * posted payments (the ภ.ง.ด.3/53 filing list, each line backed by a
 * 50 ทวิ certificate) and what customers withheld from us on posted receipts
 * (the credit we claim against corporate income tax).
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
    const withheldByUs = (await tem.execute(
      `select to_char(pm.payment_date, 'YYYY-MM-DD') as date,
              pm.payment_no, pm.wht_cert_no as cert_no,
              p.display_name as vendor_name, p.tax_id as vendor_tax_id,
              pm.wht_type as income_type, pm.wht_rate::text as rate,
              pm.total_amount::text as base, pm.wht_amount::text as wht
       from orva_ap_payments pm
       left join orva_parties p on p.id = pm.vendor_party_id
       where pm.deleted_at is null and pm.status = 'posted' and pm.tenant_id = ?::uuid
         and (?::uuid is null or pm.organization_id = ?::uuid)
         and pm.wht_amount > 0
         and to_char(pm.payment_date, 'YYYY-MM') = ?
       order by pm.payment_date, pm.payment_no`,
      [tenantId, organizationId ?? null, organizationId ?? null, month],
    )) as Array<z.infer<typeof withheldByUsSchema>>

    const withheldFromUs = (await tem.execute(
      `select to_char(r.receipt_date, 'YYYY-MM-DD') as date,
              r.receipt_no,
              (select ip.invoice_number from orva_ar_receipt_allocations a
                 join orva_ar_invoice_postings ip on ip.invoice_id = a.invoice_id
                 where a.receipt_id = r.id and a.deleted_at is null limit 1) as invoice_no,
              (select coalesce(i.metadata->'customerSnapshot'->'customer'->>'displayName',
                               i.metadata->'customerSnapshot'->>'displayName')
                 from orva_ar_receipt_allocations a
                 join sales_invoices i on i.id = a.invoice_id
                 where a.receipt_id = r.id and a.deleted_at is null limit 1) as customer_name,
              r.wht_rate::text as rate,
              r.total_amount::text as base, r.wht_amount::text as wht
       from orva_ar_receipts r
       where r.deleted_at is null and r.status = 'posted' and r.tenant_id = ?::uuid
         and (?::uuid is null or r.organization_id = ?::uuid)
         and r.wht_amount > 0
         and to_char(r.receipt_date, 'YYYY-MM') = ?
       order by r.receipt_date, r.receipt_no`,
      [tenantId, organizationId ?? null, organizationId ?? null, month],
    )) as Array<z.infer<typeof withheldFromUsSchema>>

    const total = (rows: Array<{ wht: string }>) => rows.reduce((s, r) => s + Number(r.wht), 0)
    return {
      month,
      withheldByUs,
      withheldFromUs,
      summary: { payable: total(withheldByUs).toFixed(2), receivable: total(withheldFromUs).toFixed(2) },
    }
  })
  return Response.json(result)
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaFinanceTag,
  summary: 'Withholding-tax registers (ภ.ง.ด.3/53, ภาษีถูกหัก ณ ที่จ่าย)',
  methods: {
    GET: {
      summary: 'Tax withheld from vendors and tax withheld by customers, for a month',
      tags: [orvaFinanceTag],
      query: querySchema,
      responses: [{ status: 200, description: 'WHT registers and totals.', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid query', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
