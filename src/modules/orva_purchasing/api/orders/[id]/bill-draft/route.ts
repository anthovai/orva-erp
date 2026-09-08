import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { orderIdParamsSchema } from '../../../../data/validators'
import { fail, findOrder } from '../../../../lib/orders'
import { billedByLine } from '../../../../lib/bills'
import { lineVat, round2, type VatMode } from '../../../../lib/totals'
import { isSettled } from '../../../../lib/status'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_purchasing.view', 'orva_finance.ap.view'] },
}

const draftSchema = z.object({
  orderId: z.string(),
  poNumber: z.string().nullable(),
  vendorPartyId: z.string(),
  vendorName: z.string(),
  memo: z.string().nullable(),
  /** VAT on the unbilled remainder, for the bill's own tax field. */
  taxAmount: z.number(),
  lines: z.array(
    z.object({
      lineId: z.string(),
      lineNo: z.number(),
      description: z.string(),
      accountId: z.string(),
      accountCode: z.string().nullable(),
      /** Ex-VAT amount not yet billed on this ordered line. */
      amount: z.number(),
      vatMode: z.string(),
    }),
  ),
})

type LineRow = {
  id: string
  line_no: number
  description: string
  quantity: string
  unit_price: string
  vat_mode: string
  account_id: string
  account_code: string | null
}

/**
 * What a bill for this order would say, if nobody has billed it yet.
 *
 * Only the unbilled remainder per line, so a second bill for the same order
 * offers what is left rather than the whole thing again — which is what stops
 * an order being billed twice by two people working from the same screen. The
 * numbers are ex-VAT because that is what a bill line carries; the VAT total
 * of the remainder comes back separately for the bill's own tax field.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const params = orderIdParamsSchema.safeParse(await ctx.params)
  if (!params.success) return Response.json({ error: 'ไม่พบใบสั่งซื้อ' }, { status: 404 })
  const scope = { tenantId: auth.tenantId, organizationId }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const draft = await withTenantRls(em, scope.tenantId, async (tem) => {
      const order = await findOrder(tem, scope, params.data.id)
      if (isSettled(order.status)) throw fail(409, 'ใบสั่งซื้อปิดแล้ว', 'closed')
      if (order.status === 'draft') {
        throw fail(409, 'ส่งใบสั่งซื้อให้ผู้ขายก่อนจึงจะออกบิลได้', 'invalid_transition')
      }

      const [vendor] = (await tem.execute(
        `select display_name from orva_parties
          where id = ?::uuid and tenant_id = ?::uuid and organization_id = ?::uuid and deleted_at is null`,
        [order.vendorPartyId, scope.tenantId, organizationId],
      )) as Array<{ display_name: string }>

      const rows = (await tem.execute(
        `select l.id, l.line_no, l.description, l.quantity::text as quantity,
                l.unit_price::text as unit_price, l.vat_mode, l.account_id, a.code as account_code
           from orva_purchasing_order_lines l
           left join orva_gl_accounts a on a.id = l.account_id and a.tenant_id = l.tenant_id
          where l.order_id = ?::uuid and l.tenant_id = ?::uuid and l.deleted_at is null
          order by l.line_no`,
        [order.id, scope.tenantId],
      )) as LineRow[]
      const billed = await billedByLine(tem, scope, order.id)

      const lines = rows
        .map((row) => {
          const net = round2(Number(row.quantity) * Number(row.unit_price))
          const remaining = round2(Math.max(0, net - (billed.get(row.id) ?? 0)))
          return {
            lineId: row.id,
            lineNo: row.line_no,
            description: row.description,
            accountId: row.account_id,
            accountCode: row.account_code,
            amount: remaining,
            vatMode: row.vat_mode,
          }
        })
        .filter((line) => line.amount > 0)

      const taxAmount = round2(
        lines.reduce(
          (sum, line) =>
            sum +
            lineVat({
              quantity: 1,
              unitPrice: line.amount,
              vatMode: (line.vatMode === 'none' ? 'none' : '7') as VatMode,
            }),
          0,
        ),
      )

      return {
        orderId: order.id,
        poNumber: order.poNumber ?? null,
        vendorPartyId: order.vendorPartyId,
        vendorName: vendor?.display_name ?? '—',
        memo: order.poNumber ? `ตามใบสั่งซื้อ ${order.poNumber}` : order.memo ?? null,
        taxAmount,
        lines,
      }
    })
    return Response.json(draft)
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json(
      { error: error instanceof Error ? error.message : 'Draft failed', code: (error as { code?: string }).code },
      { status },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Purchasing',
  summary: 'Prefill a vendor bill from a purchase order',
  methods: {
    GET: {
      summary: 'Vendor, accounts and the unbilled ex-VAT remainder per ordered line',
      tags: ['Orva Purchasing'],
      responses: [{ status: 200, description: 'Draft.', schema: draftSchema }],
      errors: [
        { status: 404, description: 'No such order', schema: z.object({ error: z.string() }) },
        { status: 409, description: 'The order is a draft or already settled', schema: z.object({ error: z.string(), code: z.string().optional() }) },
      ],
    },
  },
}
