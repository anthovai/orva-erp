import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { PurchaseOrderLine } from '../../../../data/entities'
import { orderIdParamsSchema, versionedSchema } from '../../../../data/validators'
import { assertVendorRole, assertVersion, fail, findOrder, loadSettings, orderEvent, vendorSnapshotFor } from '../../../../lib/orders'
import { formatPoNumber, periodKeyFor, seqAppliesTo } from '../../../../lib/numbering'
import { canTransition } from '../../../../lib/status'
import { emitPurchasingEvent } from '../../../../events'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['orva_purchasing.manage'] },
}

/**
 * Sends the order to the vendor: claims the number, freezes the lines and
 * snapshots who the vendor was.
 *
 * The number is taken here and not at create time so a draft that is
 * abandoned burns nothing, and it is periodic: the counter row is locked
 * `for update`, and when the period the format implies has rolled over the
 * run restarts at 1. Two concurrent sends therefore serialise on that row
 * instead of racing to the same number, and the unique index on
 * (organization_id, po_number) is the backstop if they ever did.
 *
 * The period is derived from the order's own date, not from today: a sheet
 * dated in September carrying an October number reads like a mistake.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const params = orderIdParamsSchema.safeParse(await ctx.params)
  if (!params.success) return Response.json({ error: 'ไม่พบใบสั่งซื้อ' }, { status: 404 })
  const parsed = versionedSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const scope = { tenantId: auth.tenantId, organizationId }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const sent = await withTenantRls(em, scope.tenantId, async (tem) => {
      const order = await findOrder(tem, scope, params.data.id)
      assertVersion(order, parsed.data.updatedAt)
      if (!canTransition(order.status, 'sent')) {
        throw fail(409, 'ส่งได้เฉพาะฉบับร่าง', 'invalid_transition')
      }
      await assertVendorRole(tem, scope, order.vendorPartyId)
      const lineCount = await tem.count(PurchaseOrderLine, { orderId: order.id, tenantId: scope.tenantId, deletedAt: null })
      if (lineCount === 0) throw fail(400, 'ใบสั่งซื้อต้องมีรายการอย่างน้อยหนึ่งบรรทัด', 'no_lines')

      const settings = await loadSettings(tem, scope)
      const [counter] = (await tem.execute(
        `select next_po_seq::text as next_po_seq, po_seq_period, po_number_format
           from orva_purchasing_settings
          where id = ?::uuid
          for update`,
        [settings.id],
      )) as Array<{ next_po_seq: string; po_seq_period: string | null; po_number_format: string }>
      const format = counter?.po_number_format ?? settings.poNumberFormat
      const orderedOn = new Date(`${order.orderDate}T00:00:00`)
      const period = periodKeyFor(format, orderedOn)
      const seq = seqAppliesTo({ storedPeriod: counter?.po_seq_period ?? null, format, date: orderedOn })
        ? Number(counter.next_po_seq)
        : 1
      const poNumber = formatPoNumber(format, { date: orderedOn, seq })
      await tem.execute(
        `update orva_purchasing_settings set next_po_seq = ?, po_seq_period = ?, updated_at = now() where id = ?::uuid`,
        [seq + 1, period, settings.id],
      )

      const now = new Date()
      order.poNumber = poNumber
      order.status = 'sent'
      order.sentAt = now
      order.vendorSnapshot = await vendorSnapshotFor(tem, scope, order.vendorPartyId)
      order.updatedAt = now
      await tem.flush()
      return order
    })
    await emitPurchasingEvent('orva_purchasing.order.sent', orderEvent(sent))
    return Response.json({ ok: true, poNumber: sent.poNumber, status: sent.status, updatedAt: sent.updatedAt.toISOString() })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json(
      { error: error instanceof Error ? error.message : 'Send failed', code: (error as { code?: string }).code },
      { status },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Purchasing',
  summary: 'Send a purchase order',
  methods: {
    POST: {
      summary: 'Claim the PO number, freeze the lines and snapshot the vendor',
      tags: ['Orva Purchasing'],
      requestBody: { schema: versionedSchema },
      responses: [
        {
          status: 200,
          description: 'Sent.',
          schema: z.object({ ok: z.literal(true), poNumber: z.string().nullable(), status: z.string(), updatedAt: z.string() }),
        },
      ],
      errors: [
        { status: 400, description: 'No lines, or the party holds no vendor role', schema: z.object({ error: z.string() }) },
        { status: 409, description: 'Stale version or not a draft', schema: z.object({ error: z.string(), code: z.string().optional() }) },
      ],
    },
  },
}
