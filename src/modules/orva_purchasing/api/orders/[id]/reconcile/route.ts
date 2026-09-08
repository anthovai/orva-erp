import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { PurchaseOrderLine } from '../../../../data/entities'
import { orderIdParamsSchema } from '../../../../data/validators'
import { fail, findOrder, orderEvent } from '../../../../lib/orders'
import { findOrphanReceipts, receivedByLine, repairOrphanReceipts } from '../../../../lib/receipts'
import { deriveReceiptStatus, isSettled } from '../../../../lib/status'
import { emitPurchasingEvent } from '../../../../events'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['orva_purchasing.receive'] },
}

/**
 * Repairs receipts that WMS has and this order does not.
 *
 * Receiving calls `orva_stock` in its own database session, so a failure in
 * this module's own write after that call leaves the goods in the warehouse
 * and the order under-reporting what arrived. This is the recovery, and it is
 * deliberately not automatic: the operator sees "there are receipts not linked
 * to this order" on the detail page and presses the button, which is a smaller
 * surprise than rows appearing on their own.
 *
 * Idempotent — the unique index on `movement_id` means a second press inserts
 * nothing — so it is safe to offer it whenever the count is above zero.
 * Deliberately takes no version: it changes nothing the operator was looking
 * at, it only writes down what the warehouse already did.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.sub) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const params = orderIdParamsSchema.safeParse(await ctx.params)
  if (!params.success) return Response.json({ error: 'ไม่พบใบสั่งซื้อ' }, { status: 404 })
  const scope = { tenantId: auth.tenantId, organizationId }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const outcome = await withTenantRls(em, scope.tenantId, async (tem) => {
      const order = await findOrder(tem, scope, params.data.id)
      if (isSettled(order.status)) throw fail(409, 'ใบสั่งซื้อปิดแล้ว', 'closed')
      const orphans = await findOrphanReceipts(tem, scope, { orderId: order.id })
      const repaired = await repairOrphanReceipts(tem, scope, orphans, auth.sub)
      if (repaired === 0) return { order, repaired, status: order.status }

      const lines = await tem.find(PurchaseOrderLine, { orderId: order.id, tenantId: scope.tenantId, deletedAt: null })
      const received = await receivedByLine(tem, scope, order.id)
      order.status = deriveReceiptStatus(
        lines.map((line) => ({ ordered: Number(line.quantity), received: received.get(line.id) ?? 0 })),
      )
      order.updatedAt = new Date()
      await tem.flush()
      return { order, repaired, status: order.status }
    })
    if (outcome.repaired > 0) {
      await emitPurchasingEvent('orva_purchasing.order.repaired', orderEvent(outcome.order))
    }
    return Response.json({
      ok: true,
      repaired: outcome.repaired,
      status: outcome.status,
      updatedAt: outcome.order.updatedAt.toISOString(),
    })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json(
      { error: error instanceof Error ? error.message : 'Reconcile failed', code: (error as { code?: string }).code },
      { status },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Purchasing',
  summary: 'Repair unlinked receipts',
  methods: {
    POST: {
      summary: 'Write receipt rows for WMS movements this order is missing (idempotent)',
      tags: ['Orva Purchasing'],
      responses: [
        {
          status: 200,
          description: 'Repaired (possibly zero).',
          schema: z.object({ ok: z.literal(true), repaired: z.number(), status: z.string(), updatedAt: z.string() }),
        },
      ],
      errors: [{ status: 409, description: 'The order is settled', schema: z.object({ error: z.string(), code: z.string().optional() }) }],
    },
  },
}
