import type { EntityManager } from '@mikro-orm/postgresql'
import { PurchaseReceipt } from '../data/entities'
import type { Scope } from './orders'

/** How much has arrived per order line, keyed by line id. */
export async function receivedByLine(
  tem: EntityManager,
  scope: Scope,
  orderId: string,
): Promise<Map<string, number>> {
  const rows = (await tem.execute(
    `select order_line_id, sum(quantity)::text as received
       from orva_purchasing_receipts
      where order_id = ?::uuid and tenant_id = ?::uuid and deleted_at is null
      group by order_line_id`,
    [orderId, scope.tenantId],
  )) as Array<{ order_line_id: string; received: string }>
  return new Map(rows.map((row) => [row.order_line_id, Number(row.received)]))
}

export type OrphanReceipt = {
  movementId: string
  orderId: string
  orderLineId: string
  quantity: number
  lotId: string | null
  lotNumber: string | null
  unitCost: number | null
  receivedOn: string
}

/**
 * WMS movements that were created for a purchase order and have no receipt row
 * here.
 *
 * This is the one failure the design cannot prevent: `orva_stock` receives in
 * its own transaction, so if this module's write fails afterwards the goods
 * are in the warehouse and the order does not know. The movement carries
 * everything needed to repair it — `reference_id` is the order, and
 * `metadata->>'poLineId'` the line — which is why those are stamped on the way
 * in rather than being nice-to-have context.
 *
 * Scoped to one organization, and to movements whose order still exists here.
 */
export async function findOrphanReceipts(
  tem: EntityManager,
  scope: Scope,
  opts: { orderId?: string } = {},
): Promise<OrphanReceipt[]> {
  const rows = (await tem.execute(
    `select m.id as movement_id,
            o.id as order_id,
            (m.metadata->>'poLineId')::uuid as order_line_id,
            m.quantity::text as quantity,
            m.lot_id,
            l.lot_number,
            c.unit_cost::text as unit_cost,
            to_char(coalesce(m.performed_at, m.created_at), 'YYYY-MM-DD') as received_on
       from wms_inventory_movements m
       join orva_purchasing_orders o
         on o.id = m.reference_id and o.deleted_at is null
        and o.tenant_id = m.tenant_id and o.organization_id = m.organization_id
       join orva_purchasing_order_lines pl
         on pl.id = (m.metadata->>'poLineId')::uuid and pl.order_id = o.id and pl.deleted_at is null
       left join wms_inventory_lots l on l.id = m.lot_id
       left join orva_stock_lot_costs c on c.movement_id = m.id and c.deleted_at is null
      where m.tenant_id = ?::uuid and m.organization_id = ?::uuid
        and m.deleted_at is null
        and m.reference_type = 'po'
        and m.metadata->>'poLineId' is not null
        and (?::uuid is null or o.id = ?::uuid)
        and not exists (
          select 1 from orva_purchasing_receipts r
           where r.movement_id = m.id and r.deleted_at is null
        )
      order by coalesce(m.performed_at, m.created_at)`,
    [scope.tenantId, scope.organizationId, opts.orderId ?? null, opts.orderId ?? null],
  )) as Array<{
    movement_id: string
    order_id: string
    order_line_id: string
    quantity: string
    lot_id: string | null
    lot_number: string | null
    unit_cost: string | null
    received_on: string
  }>
  return rows.map((row) => ({
    movementId: row.movement_id,
    orderId: row.order_id,
    orderLineId: row.order_line_id,
    quantity: Number(row.quantity),
    lotId: row.lot_id,
    lotNumber: row.lot_number,
    unitCost: row.unit_cost == null ? null : Number(row.unit_cost),
    receivedOn: row.received_on,
  }))
}

/**
 * Writes the missing receipt rows. Idempotent by construction: the unique
 * index on `movement_id` means a second pass over the same movement inserts
 * nothing, so running it twice is safe and running it often is harmless.
 */
export async function repairOrphanReceipts(
  tem: EntityManager,
  scope: Scope,
  orphans: OrphanReceipt[],
  userId: string | null,
): Promise<number> {
  if (orphans.length === 0) return 0
  const now = new Date()
  for (const orphan of orphans) {
    tem.persist(
      tem.create(PurchaseReceipt, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        orderId: orphan.orderId,
        orderLineId: orphan.orderLineId,
        quantity: orphan.quantity.toFixed(4),
        receivedOn: orphan.receivedOn,
        movementId: orphan.movementId,
        lotId: orphan.lotId,
        lotNumber: orphan.lotNumber,
        unitCost: orphan.unitCost == null ? null : orphan.unitCost.toFixed(4),
        memo: 'ซ่อมจากการรับของที่ค้างผูก (reconcile)',
        createdBy: userId,
        createdAt: now,
      }),
    )
  }
  await tem.flush()
  return orphans.length
}
