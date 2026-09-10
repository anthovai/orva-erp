import type { EntityManager } from '@mikro-orm/postgresql'
import { toPgTextArray } from '@/lib/pgArray'
import { MarketplaceImport } from '../data/entities'
import { lotsOnHand, type StockScope } from './internal'
import type { NormalizedOrder } from './marketplaceFile'

export type ResolvedLine = {
  sku: string
  name: string
  catalogVariantId: string
  quantity: number
  unitPriceGross: number
  /** lot allocations, earliest expiry first — an order may draw on more than one lot */
  lots: Array<{ lotId: string; lotNumber: string | null; quantity: number }>
}

export type ResolvedOrder = NormalizedOrder & {
  resolution: 'ready' | 'imported' | 'skipped'
  reason: string | null
  resolved: ResolvedLine[]
  gross: number
}

/**
 * The file's orders against this tenant: SKU → catalog variant, quantity →
 * lots with stock (FEFO, splitting across lots when one is not enough), and
 * "already imported" against the import log. The preview shows this; the
 * import runs it again just before writing, because stock moves.
 */
export async function resolveOrders(
  tem: EntityManager,
  scope: StockScope,
  marketplace: string,
  orders: NormalizedOrder[],
): Promise<ResolvedOrder[]> {
  const skus = [...new Set(orders.flatMap((o) => o.lines.map((l) => l.sku.toLowerCase())))]
  const variants = skus.length
    ? ((await tem.execute(
        `select v.id, v.sku, coalesce(v.name, p.title) as name
           from catalog_product_variants v
           join catalog_products p on p.id = v.product_id
          where v.tenant_id = ?::uuid and v.organization_id = ?::uuid and v.deleted_at is null
            and lower(v.sku) = any(?::text[])`,
        [scope.tenantId, scope.organizationId, toPgTextArray(skus)],
      )) as Array<{ id: string; sku: string; name: string }>)
    : []
  const bySku = new Map(variants.map((v) => [v.sku.toLowerCase(), v]))

  const ids = orders.map((o) => o.externalOrderId)
  const done = ids.length
    ? await tem.find(MarketplaceImport, { tenantId: scope.tenantId, organizationId: scope.organizationId, marketplace, status: 'imported', externalOrderId: { $in: ids } })
    : []
  const imported = new Set(done.map((row) => row.externalOrderId))

  // Stock is allocated across the whole file in order, so two orders for the
  // last bottle do not both look importable.
  const lots = await lotsOnHand(tem, scope)
  const remaining = new Map(lots.map((lot) => [lot.lot_id, Number(lot.on_hand)]))

  return orders.map((order) => {
    const gross = Math.round(order.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0) * 100) / 100
    if (imported.has(order.externalOrderId)) return { ...order, resolution: 'imported', reason: 'นำเข้าแล้วก่อนหน้านี้', resolved: [], gross }
    if (order.skipReason) return { ...order, resolution: 'skipped', reason: order.skipReason, resolved: [], gross }

    const resolved: ResolvedLine[] = []
    let reason: string | null = null
    for (const line of order.lines) {
      const variant = bySku.get(line.sku.toLowerCase())
      if (!variant) { reason = `ไม่พบ SKU "${line.sku}" ในแค็ตตาล็อก`; break }
      const candidates = lots.filter((lot) => lot.catalog_variant_id === variant.id && (remaining.get(lot.lot_id) ?? 0) > 0)
      const allocations: ResolvedLine['lots'] = []
      let need = line.quantity
      for (const lot of candidates) {
        if (need <= 0) break
        const take = Math.min(need, remaining.get(lot.lot_id) ?? 0)
        if (take <= 0) continue
        allocations.push({ lotId: lot.lot_id, lotNumber: lot.lot_number, quantity: take })
        need -= take
      }
      if (need > 0) {
        for (const a of allocations) remaining.set(a.lotId, (remaining.get(a.lotId) ?? 0) + a.quantity) // give back
        reason = `สต็อก ${variant.name} ไม่พอ (ต้องการ ${line.quantity} มีอยู่ ${line.quantity - need})`
        break
      }
      for (const a of allocations) remaining.set(a.lotId, (remaining.get(a.lotId) ?? 0) - a.quantity)
      resolved.push({ sku: line.sku, name: line.productName ?? variant.name, catalogVariantId: variant.id, quantity: line.quantity, unitPriceGross: line.unitPrice, lots: allocations })
    }
    if (reason) return { ...order, resolution: 'skipped', reason, resolved: [], gross }
    return { ...order, resolution: 'ready', reason: null, resolved, gross }
  })
}
