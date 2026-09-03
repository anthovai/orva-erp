import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { orvaFinanceTag } from '../../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_finance.ap.view'] },
}

const querySchema = z.object({ paymentId: z.string().uuid() })

const partySchema = z.object({
  name: z.string(),
  taxId: z.string().nullable(),
  branch: z.string().nullable(),
  address: z.string().nullable(),
})

const responseSchema = z.object({
  certNo: z.string().nullable(),
  /** 'PND53' for juristic payees, 'PND3' for individuals */
  form: z.string(),
  payer: partySchema,
  payee: partySchema,
  paymentDate: z.string(),
  incomeType: z.string().nullable(),
  rate: z.string().nullable(),
  amountPaid: z.string(),
  taxWithheld: z.string(),
  paymentNo: z.string().nullable(),
})

/**
 * Data for หนังสือรับรองการหักภาษี ณ ที่จ่าย (มาตรา 50 ทวิ) of one posted vendor
 * payment: payer identity from the tenant's document settings (the same
 * legal name / tax id printed on its tax invoices), payee from orva_party.
 */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const tenantId = auth.tenantId
  const organizationId = resolveActiveOrganizationId(auth)
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const result = await withTenantRls(em, tenantId, async (tem) => {
    const rows = (await tem.execute(
      `select pm.payment_no, pm.wht_cert_no, to_char(pm.payment_date, 'YYYY-MM-DD') as payment_date,
              pm.wht_type, pm.wht_rate::text as wht_rate, pm.total_amount::text as total_amount, pm.wht_amount::text as wht_amount,
              pm.organization_id, pm.status,
              p.kind as payee_kind, coalesce(p.legal_name, p.display_name) as payee_name, p.tax_id as payee_tax_id
       from orva_ap_payments pm
       left join orva_parties p on p.id = pm.vendor_party_id
       where pm.id = ?::uuid and pm.tenant_id = ?::uuid and pm.deleted_at is null`,
      [parsed.data.paymentId, tenantId],
    )) as Array<Record<string, string | null>>
    const pm = rows[0]
    if (!pm) return null
    if (pm.status !== 'posted') throw Object.assign(new Error('Certificate is issued for posted payments only'), { status: 400 })
    if (!(Number(pm.wht_amount) > 0)) throw Object.assign(new Error('This payment withheld no tax'), { status: 400 })
    const seller = (await tem.execute(
      `select seller_legal_name, seller_name, seller_tax_id, seller_branch, seller_address
       from orva_documents_settings
       where tenant_id = ?::uuid and organization_id = ?::uuid and deleted_at is null limit 1`,
      [tenantId, pm.organization_id ?? organizationId],
    )) as Array<Record<string, string | null>>
    const s = seller[0] ?? {}
    return {
      certNo: pm.wht_cert_no,
      form: pm.payee_kind === 'person' || pm.payee_kind === 'individual' ? 'PND3' : 'PND53',
      payer: { name: s.seller_legal_name ?? s.seller_name ?? '', taxId: s.seller_tax_id ?? null, branch: s.seller_branch ?? null, address: s.seller_address ?? null },
      payee: { name: pm.payee_name ?? '', taxId: pm.payee_tax_id ?? null, branch: null, address: null },
      paymentDate: pm.payment_date ?? '',
      incomeType: pm.wht_type,
      rate: pm.wht_rate,
      amountPaid: Number(pm.total_amount).toFixed(2),
      taxWithheld: Number(pm.wht_amount).toFixed(2),
      paymentNo: pm.payment_no,
    }
  })
  if (!result) return Response.json({ error: 'Payment not found' }, { status: 404 })
  return Response.json(result)
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaFinanceTag,
  summary: 'Withholding certificate (50 ทวิ) data',
  methods: {
    GET: {
      summary: 'Payer, payee and amounts for the withholding certificate of one posted payment',
      tags: [orvaFinanceTag],
      query: querySchema,
      responses: [{ status: 200, description: 'Certificate data.', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Payment not posted or withheld nothing', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Payment not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
