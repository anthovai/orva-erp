import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { PurchaseOrderLine } from '../../../../data/entities'
import { linkBillSchema, orderIdParamsSchema } from '../../../../data/validators'
import { assertVersion, fail, findOrder, orderEvent } from '../../../../lib/orders'
import { billLines, planBillLinks, persistBillLinks } from '../../../../lib/bills'
import { isSettled } from '../../../../lib/status'
import { emitPurchasingEvent } from '../../../../events'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['orva_purchasing.bill', 'orva_finance.ap.view'] },
}

const resultSchema = z.object({
  ok: z.literal(true),
  linked: z.number(),
  alreadyLinked: z.number(),
  updatedAt: z.string(),
})

/**
 * Links a bill finance already created to the order it answers.
 *
 * Two steps rather than one, and that is the whole point: purchasing never
 * creates a bill, so a failure here can never leave a half-written liability
 * in the ledger. The cost is a window where the bill exists and the link does
 * not — recovered by calling this again (it is idempotent) from the detail
 * page's "ผูกบิลที่มีอยู่" action.
 *
 * A bill line is named by position. The AP create route writes lines in
 * payload order and hands back only the bill id, so position is what a caller
 * can know for certain; this route resolves it to an id and holds the order's
 * version while it writes.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.sub) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const params = orderIdParamsSchema.safeParse(await ctx.params)
  if (!params.success) return Response.json({ error: 'ไม่พบใบสั่งซื้อ' }, { status: 404 })
  const parsed = linkBillSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const input = parsed.data
  const scope = { tenantId: auth.tenantId, organizationId }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const outcome = await withTenantRls(em, scope.tenantId, async (tem) => {
      const order = await findOrder(tem, scope, params.data.id)
      assertVersion(order, input.updatedAt)
      if (isSettled(order.status)) throw fail(409, 'ใบสั่งซื้อปิดแล้ว — ผูกบิลเพิ่มไม่ได้', 'closed')
      if (order.status === 'draft') {
        throw fail(409, 'ส่งใบสั่งซื้อให้ผู้ขายก่อนจึงจะผูกบิลได้', 'invalid_transition')
      }

      // The bill must be this order's vendor: a charge from somebody else can
      // never answer this commitment.
      const [bill] = (await tem.execute(
        `select id, vendor_party_id::text as vendor_party_id, status
           from orva_ap_bills
          where id = ?::uuid and tenant_id = ?::uuid and deleted_at is null
            and (?::uuid is null or organization_id = ?::uuid)`,
        [input.billId, scope.tenantId, organizationId, organizationId],
      )) as Array<{ id: string; vendor_party_id: string; status: string }>
      if (!bill) throw fail(404, 'ไม่พบบิลผู้ขายใบนี้', 'bill_not_found')
      if (bill.vendor_party_id !== order.vendorPartyId) {
        throw fail(400, 'บิลใบนี้เป็นของผู้ขายรายอื่น', 'vendor_mismatch')
      }

      const lines = await tem.find(PurchaseOrderLine, {
        orderId: order.id,
        tenantId: scope.tenantId,
        deletedAt: null,
      })
      const existing = (await tem.execute(
        `select bill_line_id::text as bill_line_id, order_line_id::text as order_line_id, amount::text as amount
           from orva_purchasing_bill_links
          where bill_id = ?::uuid and tenant_id = ?::uuid and deleted_at is null`,
        [input.billId, scope.tenantId],
      )) as Array<{ bill_line_id: string; order_line_id: string; amount: string }>

      const plan = planBillLinks({
        orderId: order.id,
        orderLineIds: new Set(lines.map((line) => line.id)),
        billLines: await billLines(tem, scope, input.billId),
        existing: existing.map((row) => ({
          billLineId: row.bill_line_id,
          orderLineId: row.order_line_id,
          amount: Number(row.amount),
        })),
        allocations: input.allocations,
      })
      const written = persistBillLinks(tem, scope, order.id, plan, auth.sub)
      // The order's own version moves so a stale detail page cannot link twice
      // over a figure it has not seen.
      order.updatedAt = new Date()
      await tem.flush()
      return { order, written, already: plan.length - written }
    })
    if (outcome.written > 0) {
      await emitPurchasingEvent('orva_purchasing.order.billed', orderEvent(outcome.order))
    }
    return Response.json({
      ok: true,
      linked: outcome.written,
      alreadyLinked: outcome.already,
      updatedAt: outcome.order.updatedAt.toISOString(),
    })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json(
      { error: error instanceof Error ? error.message : 'Link failed', code: (error as { code?: string }).code },
      { status },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Purchasing',
  summary: 'Link a vendor bill to a purchase order',
  methods: {
    POST: {
      summary: 'Allocate the lines of an existing bill against the ordered lines (idempotent)',
      description:
        'Purchasing never creates the bill; finance does. Re-sending identical allocations writes nothing and answers 200, so a client that lost the response can retry.',
      tags: ['Orva Purchasing'],
      requestBody: { schema: linkBillSchema },
      responses: [{ status: 200, description: 'Linked.', schema: resultSchema }],
      errors: [
        { status: 400, description: 'Amount above the bill line, duplicate allocation, or another vendor’s bill', schema: z.object({ error: z.string(), code: z.string().optional() }) },
        { status: 404, description: 'No such order, bill, order line or bill line', schema: z.object({ error: z.string(), code: z.string().optional() }) },
        { status: 409, description: 'Stale version, a draft or closed order, or a bill line already allocated elsewhere', schema: z.object({ error: z.string(), code: z.string().optional() }) },
      ],
    },
  },
}
