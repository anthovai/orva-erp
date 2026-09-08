import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { LotCost } from '../../data/entities'
import { receiveSchema } from '../../data/validators'
import { callInternal, resolveStockSite } from '../../lib/internal'
import { unitCostFromBillLine } from '../../lib/valuation'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['orva_stock.manage', 'wms.receive_inventory'] },
}

const resultSchema = z.object({
  ok: z.literal(true),
  movementId: z.string(),
  lotId: z.string().nullable(),
  unitCost: z.string(),
  quantity: z.string(),
})

/**
 * Receives a lot into stock and records what it cost. Quantities go through
 * WMS's own receive command (lot created from `lotNumber`, balance bucket,
 * receipt movement, events); the money side — unit cost from the OEM bill
 * line — is stored here so valuation and COGS can follow the lot.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.sub) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = receiveSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const input = parsed.data
  const scope = { tenantId: auth.tenantId, organizationId }
  const userId = auth.sub
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const result = await withTenantRls(em, scope.tenantId, async (tem) => {
      const site = await resolveStockSite(tem, scope)

      let unitCost = input.unitCost
      if (unitCost == null) {
        if (!input.billLineId) throw Object.assign(new Error('ระบุต้นทุนต่อหน่วย หรือเลือกบรรทัดบิลที่ซื้อมา'), { status: 400 })
        const rows = (await tem.execute(
          `select l.amount::text as amount from orva_ap_bill_lines l join orva_ap_bills b on b.id = l.bill_id
           where l.id = ?::uuid and l.tenant_id = ?::uuid and l.deleted_at is null and b.deleted_at is null`,
          [input.billLineId, scope.tenantId],
        )) as Array<{ amount: string }>
        if (!rows[0]) throw Object.assign(new Error('ไม่พบบรรทัดบิล'), { status: 404 })
        unitCost = unitCostFromBillLine(Number(rows[0].amount), input.quantity)
      }

      const received = await callInternal<{ ok: true; movementId: string }>(req, '/api/wms/inventory/receive', {
        warehouseId: site.warehouseId,
        locationId: site.locationId,
        catalogVariantId: input.catalogVariantId,
        lotNumber: input.lotNumber,
        quantity: input.quantity,
        // The caller may say what this receipt belongs to; a bill-driven
        // receive keeps its old derivation when it does not.
        referenceType: input.referenceType ?? (input.billId ? 'po' : 'manual'),
        referenceId: input.referenceId ?? input.billId ?? crypto.randomUUID(),
        performedBy: userId,
        receivedAt: new Date(`${input.receivedOn}T00:00:00Z`).toISOString(),
        reason: input.reason ?? (input.billId ? 'รับเข้าจากบิลผู้ขาย' : 'รับเข้าคลัง'),
        metadata: {
          source: 'orva_stock',
          billId: input.billId ?? null,
          billLineId: input.billLineId ?? null,
          // Traceability for the caller that owns the commitment: purchasing
          // finds an unlinked receipt by this and repairs it.
          poLineId: input.poLineId ?? null,
        },
      })

      const movement = (await tem.execute(
        `select lot_id from wms_inventory_movements where id = ?::uuid and tenant_id = ?::uuid`,
        [received.movementId, scope.tenantId],
      )) as Array<{ lot_id: string | null }>
      const lotId = movement[0]?.lot_id ?? null
      if (lotId && (input.expiresOn || input.manufacturedOn)) {
        await tem.execute(
          `update wms_inventory_lots set expires_at = coalesce(?::date, expires_at), manufactured_at = coalesce(?::date, manufactured_at), updated_at = now()
           where id = ?::uuid and tenant_id = ?::uuid`,
          [input.expiresOn ?? null, input.manufacturedOn ?? null, lotId, scope.tenantId],
        )
      }
      if (!lotId) throw Object.assign(new Error('WMS did not return a lot for this receipt'), { status: 502 })

      const now = new Date()
      tem.persist(tem.create(LotCost, {
        tenantId: scope.tenantId, organizationId, lotId, catalogVariantId: input.catalogVariantId,
        receivedQty: input.quantity.toFixed(4), unitCost: unitCost.toFixed(4),
        billId: input.billId ?? null, billLineId: input.billLineId ?? null, movementId: received.movementId,
        receivedOn: input.receivedOn, createdBy: userId, createdAt: now, updatedAt: now,
      }))
      await tem.flush()
      return { ok: true as const, movementId: received.movementId, lotId, unitCost: unitCost.toFixed(4), quantity: input.quantity.toFixed(4) }
    })
    return Response.json(result)
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json({ error: error instanceof Error ? error.message : 'Receive failed' }, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Stock',
  summary: 'Receive a lot into stock with its cost',
  methods: {
    POST: {
      summary: 'Receive quantity into the default warehouse (via WMS) and record the unit cost from the OEM bill',
      tags: ['Orva Stock'],
      requestBody: { schema: receiveSchema },
      responses: [{ status: 200, description: 'Received.', schema: resultSchema }],
      errors: [
        { status: 400, description: 'Invalid payload or no warehouse configured', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
