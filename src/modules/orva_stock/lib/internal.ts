import type { EntityManager } from '@mikro-orm/postgresql'
import { StockSettings } from '../data/entities'

/**
 * Calls another module's API route on this same server with the caller's
 * cookies — the pattern orva_documents' issue-invoice uses to mint numbers.
 * Keeps WMS/sales/documents behaviour (RBAC, commands, events, audit) exactly
 * as when the operator uses those screens, instead of reaching into their
 * tables from here.
 */
export async function callInternal<T = Record<string, unknown>>(req: Request, path: string, body: Record<string, unknown> | null, method: 'POST' | 'GET' | 'PUT' = 'POST'): Promise<T> {
  const origin = new URL(req.url).origin
  const res = await fetch(new URL(path, origin), {
    method,
    headers: { 'content-type': 'application/json', cookie: req.headers.get('cookie') ?? '' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
  })
  const json = (await res.json().catch(() => null)) as T | null
  if (!res.ok) {
    const message = (json as { error?: string; message?: string } | null)?.error ?? (json as { message?: string } | null)?.message ?? `HTTP ${res.status}`
    throw Object.assign(new Error(`${path}: ${message}`), { status: res.status >= 500 ? 502 : res.status })
  }
  return (json ?? {}) as T
}

export type StockScope = { tenantId: string; organizationId: string }

/** Settings row plus the warehouse/location the stock lives in (single-site by default). */
export async function resolveStockSite(tem: EntityManager, scope: StockScope): Promise<{ settings: StockSettings | null; warehouseId: string; locationId: string }> {
  const settings = await tem.findOne(StockSettings, { tenantId: scope.tenantId, organizationId: scope.organizationId })
  let warehouseId = settings?.warehouseId ?? null
  if (!warehouseId) {
    const rows = (await tem.execute(
      `select id from wms_warehouses where tenant_id = ?::uuid and organization_id = ?::uuid and deleted_at is null and is_active order by is_primary desc, created_at limit 1`,
      [scope.tenantId, scope.organizationId],
    )) as Array<{ id: string }>
    warehouseId = rows[0]?.id ?? null
  }
  if (!warehouseId) throw Object.assign(new Error('ยังไม่มีคลังสินค้า — สร้างคลังและตำแหน่งเก็บใน WMS ก่อน'), { status: 400 })
  let locationId = settings?.locationId ?? null
  if (!locationId) {
    const rows = (await tem.execute(
      `select id from wms_warehouse_locations where tenant_id = ?::uuid and warehouse_id = ?::uuid and deleted_at is null and is_active order by created_at limit 1`,
      [scope.tenantId, warehouseId],
    )) as Array<{ id: string }>
    locationId = rows[0]?.id ?? null
  }
  if (!locationId) throw Object.assign(new Error('คลังนี้ยังไม่มีตำแหน่งเก็บ — เพิ่มตำแหน่งเก็บใน WMS ก่อน'), { status: 400 })
  return { settings, warehouseId, locationId }
}

export type LotRow = {
  lot_id: string; catalog_variant_id: string; variant_name: string | null; sku: string | null
  lot_number: string | null; expires_at: string | null; on_hand: string; unit_cost: string | null
}

/** Lots with on-hand quantity (WMS balances) and the lot cost recorded here. */
export async function lotsOnHand(tem: EntityManager, scope: StockScope, opts: { catalogVariantId?: string; includeEmpty?: boolean } = {}): Promise<LotRow[]> {
  return (await tem.execute(
    `select l.id as lot_id, l.catalog_variant_id, v.name as variant_name, coalesce(l.sku, v.sku) as sku,
            l.lot_number, to_char(l.expires_at, 'YYYY-MM-DD') as expires_at,
            coalesce(sum(b.quantity_on_hand), 0)::text as on_hand,
            (select (sum(c.unit_cost * c.received_qty) / nullif(sum(c.received_qty), 0))::text
               from orva_stock_lot_costs c where c.lot_id = l.id and c.deleted_at is null) as unit_cost
     from wms_inventory_lots l
     left join catalog_product_variants v on v.id = l.catalog_variant_id
     left join wms_inventory_balances b on b.lot_id = l.id and b.deleted_at is null
     where l.tenant_id = ?::uuid and l.organization_id = ?::uuid and l.deleted_at is null
       and (?::uuid is null or l.catalog_variant_id = ?::uuid)
     group by l.id, l.catalog_variant_id, v.name, v.sku, l.lot_number, l.expires_at
     having ? or coalesce(sum(b.quantity_on_hand), 0) > 0
     order by l.expires_at nulls last, l.lot_number`,
    [scope.tenantId, scope.organizationId, opts.catalogVariantId ?? null, opts.catalogVariantId ?? null, opts.includeEmpty === true],
  )) as LotRow[]
}
