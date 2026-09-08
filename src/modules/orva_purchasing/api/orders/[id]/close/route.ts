import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { PurchaseOrderLine } from '../../../../data/entities'
import { orderIdParamsSchema, reasonedSchema } from '../../../../data/validators'
import { assertVersion, fail, findOrder, orderEvent } from '../../../../lib/orders'
import { receivedByLine } from '../../../../lib/receipts'
import { canTransition } from '../../../../lib/status'
import { emitPurchasingEvent } from '../../../../events'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['orva_purchasing.manage'] },
}

/**
 * Closes an order and records what never arrived.
 *
 * This is the only manual exit from a sent order, and the only way to stop
 * chasing a delivery that is never coming: each line freezes
 * `short_qty = ordered − received`, so the shortfall is a stated fact rather
 * than a quantity quietly edited downwards. A closed order leaves the late
 * scan and the committed-not-billed figure, and accepts no further receipts
 * or bill links.
 *
 * An order with nothing received closes with its whole quantity short, which
 * is exactly right for one the vendor never fulfilled.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const params = orderIdParamsSchema.safeParse(await ctx.params)
  if (!params.success) return Response.json({ error: 'ไม่พบใบสั่งซื้อ' }, { status: 404 })
  const parsed = reasonedSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'ต้องระบุเหตุผลที่ปิด', issues: parsed.error.issues }, { status: 400 })
  const scope = { tenantId: auth.tenantId, organizationId }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const closed = await withTenantRls(em, scope.tenantId, async (tem) => {
      const order = await findOrder(tem, scope, params.data.id)
      assertVersion(order, parsed.data.updatedAt)
      if (!canTransition(order.status, 'closed')) {
        throw fail(409, order.status === 'draft' ? 'ฉบับร่างให้ลบหรือยกเลิก ไม่ต้องปิด' : 'ปิดไม่ได้ในสถานะนี้', 'invalid_transition')
      }
      const now = new Date()
      const lines = await tem.find(PurchaseOrderLine, { orderId: order.id, tenantId: scope.tenantId, deletedAt: null })
      const received = await receivedByLine(tem, scope, order.id)
      const shortfalls: Array<{ lineNo: number; description: string; shortQty: number }> = []
      for (const line of lines) {
        const short = Math.max(0, Number(line.quantity) - (received.get(line.id) ?? 0))
        line.shortQty = short.toFixed(4)
        line.updatedAt = now
        if (short > 0) shortfalls.push({ lineNo: line.lineNo, description: line.description, shortQty: short })
      }
      order.status = 'closed'
      order.closedAt = now
      order.closeReason = parsed.data.reason
      order.updatedAt = now
      await tem.flush()
      return { order, shortfalls }
    })
    await emitPurchasingEvent('orva_purchasing.order.closed', orderEvent(closed.order))
    return Response.json({
      ok: true,
      status: closed.order.status,
      shortQty: closed.shortfalls,
      updatedAt: closed.order.updatedAt.toISOString(),
    })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json(
      { error: error instanceof Error ? error.message : 'Close failed', code: (error as { code?: string }).code },
      { status },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Purchasing',
  summary: 'Close a purchase order',
  methods: {
    POST: {
      summary: 'Stop chasing an order and record the shortfall per line',
      tags: ['Orva Purchasing'],
      requestBody: { schema: reasonedSchema },
      responses: [
        {
          status: 200,
          description: 'Closed.',
          schema: z.object({
            ok: z.literal(true),
            status: z.string(),
            shortQty: z.array(z.object({ lineNo: z.number(), description: z.string(), shortQty: z.number() })),
            updatedAt: z.string(),
          }),
        },
      ],
      errors: [{ status: 409, description: 'Stale version or wrong status', schema: z.object({ error: z.string(), code: z.string().optional() }) }],
    },
  },
}
