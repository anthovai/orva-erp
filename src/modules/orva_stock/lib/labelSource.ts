import type { EntityManager } from '@mikro-orm/postgresql'

/**
 * What a lot label needs to know, read from the three places it lives.
 *
 * The lot (number, MFG, EXP) is WMS's; the product's title, pack size, brand
 * and FDA notification number are the catalog's — two of them custom fields
 * declared in `orva/ce.ts` — and the variant's SKU and GS1 code are the
 * variant's. This module owns none of those records, so it reads them by id
 * and joins nothing across module boundaries in the ORM.
 *
 * Registered in DI as `orvaStockLabelSource` for `orva_documents`, which
 * prints the label and must not import stock. The shape here is structural on
 * purpose: it matches `orva_documents/lib/stockBridge.ts` without importing it,
 * so the two modules stay separately shippable.
 */
export type LotLabelData = {
  lot: { id: string; lotNumber: string | null; manufacturedOn: string | null; expiresOn: string | null }
  product: { title: string; packSize: string | null; fdaNotification: string | null; brandCode: string | null }
  variant: { sku: string | null; barcode: string | null; gtinType: string | null }
}

type LotRow = {
  lot_id: string
  lot_number: string | null
  manufactured_at: string | null
  expires_at: string | null
  variant_name: string | null
  sku: string | null
  barcode: string | null
  gtin_type: string | null
  product_id: string | null
  title: string | null
  subtitle: string | null
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)

export async function findLotForLabel(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  lotId: string,
): Promise<LotLabelData | null> {
  const rows = (await em.execute(
    `select l.id as lot_id, l.lot_number,
            to_char(l.manufactured_at, 'YYYY-MM-DD') as manufactured_at,
            to_char(l.expires_at, 'YYYY-MM-DD') as expires_at,
            v.name as variant_name, v.sku, v.barcode, v.gtin_type,
            p.id::text as product_id, p.title, p.subtitle
     from wms_inventory_lots l
     left join catalog_product_variants v on v.id = l.catalog_variant_id
     left join catalog_products p on p.id = v.product_id
     where l.id = ?::uuid and l.tenant_id = ?::uuid and l.organization_id = ?::uuid and l.deleted_at is null`,
    [lotId, scope.tenantId, scope.organizationId],
  )) as LotRow[]
  const row = rows[0]
  if (!row) return null

  // The two custom fields, read as columns (the reportQueries precedent):
  // the framework loader showed null for rows that exist when run inside the
  // app, and a label must not print a gap for a number that is on record.
  let fdaNotification: string | null = null
  let brandCode: string | null = null
  if (row.product_id) {
    const values = (await em.execute(
      `select field_key, value_text
         from custom_field_values
        where record_id = ? and entity_id = 'catalog:catalog_product'
          and field_key in ('th_fda_notification', 'product_brand')
          and deleted_at is null and tenant_id = ?::uuid
        order by created_at desc`,
      [row.product_id, scope.tenantId],
    )) as Array<{ field_key: string; value_text: string | null }>
    for (const value of values) {
      if (value.field_key === 'th_fda_notification' && fdaNotification === null) fdaNotification = text(value.value_text)
      if (value.field_key === 'product_brand' && brandCode === null) brandCode = text(value.value_text)
    }
  }

  return {
    lot: { id: row.lot_id, lotNumber: text(row.lot_number), manufacturedOn: row.manufactured_at, expiresOn: row.expires_at },
    product: {
      title: text(row.title) ?? text(row.variant_name) ?? '—',
      // The pack size: the product's subtitle when it has one ("200 มล."),
      // else the variant's name — which on a single-variant product often just
      // repeats the title, so the subtitle is asked first.
      packSize: text(row.subtitle) ?? text(row.variant_name),
      fdaNotification,
      brandCode,
    },
    variant: { sku: text(row.sku), barcode: text(row.barcode), gtinType: text(row.gtin_type) },
  }
}

/** The DI registration `orva_documents` resolves softly. */
export const stockLabelSource = { findLot: findLotForLabel }
