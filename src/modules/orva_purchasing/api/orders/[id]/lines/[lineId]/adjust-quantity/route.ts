import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { PurchaseOrderLine } from '../../../../../../data/entities'
import { adjustQuantitySchema, lineIdParamsSchema } from '../../../../../../data/validators'
import { applyTotals, assertVersion, fail, findOrder, orderEvent } from '../../../../../../lib/orders'
import { acceptsGoods, isSettled } from '../../../../../../lib/status'
import { emitPurchasingEvent } from '../../../../../../events'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['orva_purchasing.manage'] },
}

/**
 * Raises the ordered quantity of a line on a sent order.
 *
 * The one edit a frozen order allows, and it exists for a physical fact: the
 * vendor delivered more than was ordered, and the receipt must be recordable
 * without lying about either number. It only ever goes up — a quantity that
 * should come down is a short close, which records the shortfall instead of
 * rewriting what was promised — and it demands a reason, because this is the
 * moment the commitment changed after the vendor was told what it was.
 *
 * A draft's quantities are edited through the ordinary order update; this
 * route deliberately refuses one, so there is exactly one way to change a
 * draft and exactly one way to change a sent order.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string; lineId: string }> }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const params = lineIdParamsSchema.safeParse(await ctx.params)
  if (!params.success) return Response.json({ error: 'ไม่พบบรรทัดนี้' }, { status: 404 })
  const parsed = adjustQuantitySchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const scope = { tenantId: auth.tenantId, organizationId }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const result = await withTenantRls(em, scope.tenantId, async (tem) => {
      const order = await findOrder(tem, scope, params.data.id)
      assertVersion(order, parsed.data.updatedAt)
      if (isSettled(order.status)) throw fail(409, 'ใบสั่งซื้อปิดแล้ว', 'closed')
      if (!acceptsGoods(order.status)) {
        throw fail(409, 'ฉบับร่างให้แก้จำนวนในหน้าแก้ไขใบสั่งซื้อ', 'invalid_transition')
      }
      const line = await tem.findOne(PurchaseOrderLine, {
        id: params.data.lineId,
        orderId: order.id,
        tenantId: scope.tenantId,
        deletedAt: null,
      })
      if (!line) throw fail(404, 'ไม่พบบรรทัดนี้', 'line_not_found')
      const current = Number(line.quantity)
      if (parsed.data.quantity <= current) {
        throw fail(
          400,
          `จำนวนต้องมากกว่าเดิม (${current.toLocaleString('th-TH')}) — ถ้าของมาไม่ครบให้ปิดใบสั่งซื้อพร้อมเหตุผล`,
          'not_an_increase',
        )
      }
      const now = new Date()
      line.quantity = parsed.data.quantity.toFixed(4)
      line.updatedAt = now
      const lines = await tem.find(PurchaseOrderLine, { orderId: order.id, tenantId: scope.tenantId, deletedAt: null })
      applyTotals(
        order,
        lines.map((row) => ({
          quantity: row.id === line.id ? parsed.data.quantity : Number(row.quantity),
          unitPrice: Number(row.unitPrice),
          vatMode: row.vatMode,
        })),
      )
      order.memo = [order.memo, `[${now.toISOString().slice(0, 10)}] เพิ่มจำนวนบรรทัด ${line.lineNo} จาก ${current} เป็น ${parsed.data.quantity}: ${parsed.data.reason}`]
        .filter(Boolean)
        .join('\n')
      order.updatedAt = now
      await tem.flush()
      return { order, lineNo: line.lineNo, from: current, to: parsed.data.quantity }
    })
    await emitPurchasingEvent('orva_purchasing.order.line_adjusted', orderEvent(result.order))
    return Response.json({
      ok: true,
      lineNo: result.lineNo,
      from: result.from,
      to: result.to,
      updatedAt: result.order.updatedAt.toISOString(),
    })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json(
      { error: error instanceof Error ? error.message : 'Adjust failed', code: (error as { code?: string }).code },
      { status },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Purchasing',
  summary: 'Raise an ordered quantity',
  methods: {
    POST: {
      summary: 'Increase one line of a sent order, with a reason (the only edit a frozen order allows)',
      tags: ['Orva Purchasing'],
      requestBody: { schema: adjustQuantitySchema },
      responses: [
        {
          status: 200,
          description: 'Raised.',
          schema: z.object({ ok: z.literal(true), lineNo: z.number(), from: z.number(), to: z.number(), updatedAt: z.string() }),
        },
      ],
      errors: [
        { status: 400, description: 'Not an increase', schema: z.object({ error: z.string(), code: z.string().optional() }) },
        { status: 409, description: 'Stale version, a draft, or a closed order', schema: z.object({ error: z.string(), code: z.string().optional() }) },
      ],
    },
  },
}
