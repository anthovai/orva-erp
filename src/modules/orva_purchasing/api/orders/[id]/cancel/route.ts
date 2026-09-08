import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { orderIdParamsSchema, reasonedSchema } from '../../../../data/validators'
import { assertVersion, fail, findOrder, orderEvent } from '../../../../lib/orders'
import { canTransition } from '../../../../lib/status'
import { emitPurchasingEvent } from '../../../../events'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['orva_purchasing.manage'] },
}

/**
 * Cancels an order that never happened.
 *
 * Cancelling says the commitment is void, which is only true while nothing
 * has arrived and nothing has been billed against it. Once either has, the
 * order did happen and the honest exit is a short close, which records what
 * was missing instead of erasing the promise.
 *
 * Phases A2 and A3 add the receipt and bill-link tables; the guards that read
 * them land with those tables, because until they exist there is nothing that
 * could contradict a cancellation.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const params = orderIdParamsSchema.safeParse(await ctx.params)
  if (!params.success) return Response.json({ error: 'ไม่พบใบสั่งซื้อ' }, { status: 404 })
  const parsed = reasonedSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'ต้องระบุเหตุผลที่ยกเลิก', issues: parsed.error.issues }, { status: 400 })
  const scope = { tenantId: auth.tenantId, organizationId }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const cancelled = await withTenantRls(em, scope.tenantId, async (tem) => {
      const order = await findOrder(tem, scope, params.data.id)
      assertVersion(order, parsed.data.updatedAt)
      if (!canTransition(order.status, 'cancelled')) {
        throw fail(
          409,
          order.status === 'partially_received' || order.status === 'received'
            ? 'มีของมาแล้ว — ปิดใบสั่งซื้อพร้อมเหตุผลแทนการยกเลิก'
            : 'ยกเลิกไม่ได้ในสถานะนี้',
          'invalid_transition',
        )
      }
      const now = new Date()
      order.status = 'cancelled'
      order.cancelledAt = now
      order.closeReason = parsed.data.reason
      order.updatedAt = now
      await tem.flush()
      return order
    })
    await emitPurchasingEvent('orva_purchasing.order.cancelled', orderEvent(cancelled))
    return Response.json({ ok: true, status: cancelled.status, updatedAt: cancelled.updatedAt.toISOString() })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json(
      { error: error instanceof Error ? error.message : 'Cancel failed', code: (error as { code?: string }).code },
      { status },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Purchasing',
  summary: 'Cancel a purchase order',
  methods: {
    POST: {
      summary: 'Void an order that never happened (nothing received, nothing billed)',
      tags: ['Orva Purchasing'],
      requestBody: { schema: reasonedSchema },
      responses: [{ status: 200, description: 'Cancelled.', schema: z.object({ ok: z.literal(true), status: z.string(), updatedAt: z.string() }) }],
      errors: [{ status: 409, description: 'Stale version, or goods/bills exist', schema: z.object({ error: z.string(), code: z.string().optional() }) }],
    },
  },
}
