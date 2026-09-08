import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { PurchaseReceipt } from '../../../../data/entities'
import { orderIdParamsSchema, receiveSchema } from '../../../../data/validators'
import { assertVersion, fail, findOrder, orderEvent } from '../../../../lib/orders'
import { receivedByLine } from '../../../../lib/receipts'
import { planReceipt, type ReceivePlanFailure } from '../../../../lib/receivePlan'
import { callInternal } from '../../../../lib/internal'
import { acceptsGoods, deriveReceiptStatus, isSettled } from '../../../../lib/status'
import { emitPurchasingEvent } from '../../../../events'

export const metadata = {
  // Goods additionally need orva_stock.manage and wms.receive_inventory, which
  // the internal receive call enforces with the caller's own cookies rather
  // than this route re-declaring another module's authority.
  POST: { requireAuth: true, requireFeatures: ['orva_purchasing.receive'] },
}

/** The plan's refusals, in the operator's words. */
function failureToError(failure: ReceivePlanFailure): Error {
  switch (failure.code) {
    case 'line_not_found':
      return fail(404, 'ไม่พบบรรทัดนี้ในใบสั่งซื้อ', 'line_not_found')
    case 'over_receipt':
      return fail(
        409,
        `บรรทัด ${failure.lineNo} (${failure.description}) รับเกินจำนวนที่สั่ง — เหลือรับได้ ` +
          `${failure.remaining.toLocaleString('th-TH')}${failure.unit ? ` ${failure.unit}` : ''}`,
        'over_receipt',
      )
    case 'lot_required':
      return fail(400, `บรรทัด ${failure.lineNo} เป็นสินค้า — ต้องระบุเลขล็อต`, 'lot_required')
    case 'nothing_to_receive':
      return fail(400, 'ใส่จำนวนที่รับอย่างน้อยหนึ่งบรรทัด', 'nothing_to_receive')
  }
}

type LineRow = {
  id: string
  line_no: number
  kind: string
  catalog_variant_id: string | null
  description: string
  sku: string | null
  quantity: string
  unit: string | null
  unit_price: string
}

const receiptSchema = z.object({
  lineId: z.string(),
  lineNo: z.number(),
  description: z.string(),
  quantity: z.number(),
  movementId: z.string().nullable(),
  lotId: z.string().nullable(),
})

const resultSchema = z.object({
  ok: z.literal(true),
  receipts: z.array(receiptSchema),
  status: z.string(),
  updatedAt: z.string(),
})

/**
 * Records what arrived.
 *
 * Order of operations is the whole design. Every line is validated first —
 * exists, right kind, within what is still outstanding — so a payload with one
 * bad line moves no stock at all. Only then does each goods line go through
 * `orva_stock`, which owns lot costs and is the only caller of WMS, and only
 * after it answers 2xx is the local receipt written.
 *
 * That call is a separate database session, so it cannot join this
 * transaction. If this module's own write fails after it, the goods are in the
 * warehouse and the order does not know — which is exactly what
 * `orva_purchasing reconcile` (and the detail page's repair button) exists to
 * fix, using the order and line ids stamped on the movement.
 *
 * The lines are locked `for update` before the outstanding quantity is read,
 * so two people receiving the same delivery serialise instead of both being
 * told there is room.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.sub) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const params = orderIdParamsSchema.safeParse(await ctx.params)
  if (!params.success) return Response.json({ error: 'ไม่พบใบสั่งซื้อ' }, { status: 404 })
  const parsed = receiveSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const input = parsed.data
  const scope = { tenantId: auth.tenantId, organizationId }
  const userId = auth.sub
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const outcome = await withTenantRls(em, scope.tenantId, async (tem) => {
      const order = await findOrder(tem, scope, params.data.id)
      assertVersion(order, input.updatedAt)
      if (isSettled(order.status)) {
        throw fail(409, 'ใบสั่งซื้อปิดแล้ว — รับของเพิ่มไม่ได้', 'closed')
      }
      if (!acceptsGoods(order.status)) {
        throw fail(409, 'ส่งใบสั่งซื้อให้ผู้ขายก่อนจึงจะรับของได้', 'invalid_transition')
      }

      const lines = (await tem.execute(
        `select id, line_no, kind, catalog_variant_id, description, sku,
                quantity::text as quantity, unit, unit_price::text as unit_price
           from orva_purchasing_order_lines
          where order_id = ?::uuid and tenant_id = ?::uuid and deleted_at is null
          order by line_no
            for update`,
        [order.id, scope.tenantId],
      )) as LineRow[]
      const received = await receivedByLine(tem, scope, order.id)

      // Decide everything before anything moves (lib/receivePlan.ts).
      const plan = planReceipt({
        lines: lines.map((line) => ({
          id: line.id,
          lineNo: line.line_no,
          kind: line.kind,
          description: line.description,
          unit: line.unit,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unit_price),
        })),
        received,
        request: input.lines.map((item) => ({
          lineId: item.lineId,
          quantity: item.quantity,
          lotNumber: item.lotNumber ?? null,
          unitCost: item.unitCost ?? null,
        })),
      })
      if (!plan.ok) throw failureToError(plan.failure)
      const byId = new Map(lines.map((line) => [line.id, line]))

      const receipts: Array<z.infer<typeof receiptSchema>> = []
      const now = new Date()
      for (const item of plan.items) {
        const line = byId.get(item.line.id)!
        const requested = input.lines.find((row) => row.lineId === line.id)
        let movementId: string | null = null
        let lotId: string | null = null
        const unitCost = item.unitCost
        if (line.kind === 'goods') {
          const stock = await callInternal<{ ok: true; movementId: string; lotId: string | null }>(
            req,
            '/api/orva_stock/receive',
            {
              catalogVariantId: line.catalog_variant_id,
              quantity: item.quantity,
              unitCost,
              lotNumber: item.lotNumber,
              manufacturedOn: requested?.manufacturedOn ?? null,
              expiresOn: requested?.expiresOn ?? null,
              receivedOn: input.receivedOn,
              reason: `รับเข้าจากใบสั่งซื้อ ${order.poNumber ?? ''}`.trim(),
              referenceType: 'po',
              referenceId: order.id,
              poLineId: line.id,
            },
          )
          movementId = stock.movementId
          lotId = stock.lotId ?? null
        }
        tem.persist(
          tem.create(PurchaseReceipt, {
            tenantId: scope.tenantId,
            organizationId,
            orderId: order.id,
            orderLineId: line.id,
            quantity: item.quantity.toFixed(4),
            receivedOn: input.receivedOn,
            movementId,
            lotId,
            lotNumber: item.lotNumber,
            unitCost: line.kind === 'goods' ? unitCost.toFixed(4) : null,
            memo: requested?.memo ?? null,
            createdBy: userId,
            createdAt: now,
          }),
        )
        receipts.push({
          lineId: line.id,
          lineNo: line.line_no,
          description: line.description,
          quantity: item.quantity,
          movementId,
          lotId,
        })
      }
      await tem.flush()

      // Status follows the receipts, never a flag somebody set.
      const after = await receivedByLine(tem, scope, order.id)
      const status = deriveReceiptStatus(
        lines.map((line) => ({ ordered: Number(line.quantity), received: after.get(line.id) ?? 0 })),
      )
      order.status = status
      order.updatedAt = new Date()
      await tem.flush()
      return { order, receipts, status }
    })
    await emitPurchasingEvent('orva_purchasing.order.received', orderEvent(outcome.order))
    return Response.json({
      ok: true,
      receipts: outcome.receipts,
      status: outcome.status,
      updatedAt: outcome.order.updatedAt.toISOString(),
    })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json(
      { error: error instanceof Error ? error.message : 'Receive failed', code: (error as { code?: string }).code },
      { status },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Purchasing',
  summary: 'Receive against a purchase order',
  methods: {
    POST: {
      summary: 'Record what arrived: goods through orva_stock into WMS, services directly',
      tags: ['Orva Purchasing'],
      requestBody: { schema: receiveSchema },
      responses: [{ status: 200, description: 'Received.', schema: resultSchema }],
      errors: [
        { status: 400, description: 'A goods line with no lot number, or a stock error passed through', schema: z.object({ error: z.string(), code: z.string().optional() }) },
        { status: 404, description: 'No such order or line', schema: z.object({ error: z.string() }) },
        {
          status: 409,
          description: 'Over-receipt (nothing written), a draft, a closed order, or a stale version',
          schema: z.object({ error: z.string(), code: z.string().optional() }),
        },
      ],
    },
  },
}
