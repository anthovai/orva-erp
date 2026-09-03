import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { vatReport } from '../../../lib/reportQueries'
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

  const result = await withTenantRls(em, tenantId, (tem) => vatReport(tem, { tenantId, organizationId }, month))
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
