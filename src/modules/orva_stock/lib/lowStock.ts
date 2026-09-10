import type { EntityManager } from '@mikro-orm/postgresql'

export type LowStockRow = {
  variantId: string
  productId: string
  name: string
  sku: string | null
  onHand: number
  reorderPoint: number
}

/**
 * Variants whose on-hand (every lot, WMS balances) has fallen to the product's
 * reorder point or below.
 *
 * The reorder point is the `reorder_point` custom field on
 * `catalog:catalog_product` (declared in `orva/ce.ts`), read straight off
 * `custom_field_values` — the precedent G3 set when the framework loader
 * returned nothing for stored rows inside the running app. The newest row per
 * product wins; products with no point, or a point of zero, never alert.
 * Ordered by how far below the line each one is, emptiest first.
 */
export async function lowStockVariants(
  tem: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<LowStockRow[]> {
  const rows = (await tem.execute(
    `with points as (
       select distinct on (record_id) record_id, value_int as reorder_point
         from custom_field_values
        where tenant_id = ?::uuid and entity_id = 'catalog:catalog_product'
          and field_key = 'reorder_point' and deleted_at is null
        order by record_id, created_at desc
     )
     select v.id as variant_id, v.product_id, coalesce(v.name, p.title) as name, v.sku,
            coalesce(sum(b.quantity_on_hand), 0)::text as on_hand, pt.reorder_point
       from catalog_product_variants v
       join catalog_products p on p.id = v.product_id
       join points pt on pt.record_id = v.product_id::text
       left join wms_inventory_lots l on l.catalog_variant_id = v.id and l.deleted_at is null
       left join wms_inventory_balances b on b.lot_id = l.id and b.deleted_at is null
      where v.tenant_id = ?::uuid and v.organization_id = ?::uuid and v.deleted_at is null
        and v.is_active and pt.reorder_point is not null and pt.reorder_point > 0
      group by v.id, v.product_id, v.name, p.title, v.sku, pt.reorder_point
     having coalesce(sum(b.quantity_on_hand), 0) <= pt.reorder_point
      order by coalesce(sum(b.quantity_on_hand), 0) / pt.reorder_point asc, coalesce(v.name, p.title)`,
    [scope.tenantId, scope.tenantId, scope.organizationId],
  )) as Array<{ variant_id: string; product_id: string; name: string; sku: string | null; on_hand: string; reorder_point: number | string }>
  return rows.map((row) => ({
    variantId: row.variant_id,
    productId: row.product_id,
    name: row.name,
    sku: row.sku,
    onHand: Number(row.on_hand),
    reorderPoint: Number(row.reorder_point),
  }))
}
