import type { EntityManager } from '@mikro-orm/postgresql'

/**
 * Pure stock math. Each lot carries the unit cost it was received at (from
 * the OEM bill), so valuation is lot-specific: on-hand × that lot's cost.
 * Issues are costed at the lot's cost too (FEFO/FIFO is a picking choice made
 * when the lot is chosen; the money follows the lot).
 */
export type LotOnHand = {
  lotId: string
  variantId: string
  variantName: string | null
  sku: string | null
  lotNumber: string | null
  expiresAt: string | null
  onHand: number
  unitCost: number | null
}

export type ValuationLine = LotOnHand & { value: number; daysToExpiry: number | null; expiryState: 'ok' | 'soon' | 'expired' | 'unknown' }

export type Valuation = {
  asOf: string
  lines: ValuationLine[]
  totalOnHand: number
  totalValue: number
  uncosted: number
  expiringSoon: number
  expired: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

function daysBetween(from: string, to: string): number {
  const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)))
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)))
  return Math.round((b - a) / 86_400_000)
}

/** Values every lot, flags expiry within `soonDays`, sorts soonest expiry first. */
export function buildValuation(asOf: string, lots: LotOnHand[], soonDays = 90): Valuation {
  const lines: ValuationLine[] = lots
    .filter((lot) => lot.onHand > 0)
    .map((lot) => {
      const days = lot.expiresAt ? daysBetween(asOf, lot.expiresAt) : null
      const expiryState: ValuationLine['expiryState'] = days == null ? 'unknown' : days < 0 ? 'expired' : days <= soonDays ? 'soon' : 'ok'
      return { ...lot, value: lot.unitCost == null ? 0 : round2(lot.onHand * lot.unitCost), daysToExpiry: days, expiryState }
    })
    .sort((a, b) => (a.daysToExpiry ?? Number.MAX_SAFE_INTEGER) - (b.daysToExpiry ?? Number.MAX_SAFE_INTEGER) || a.lotId.localeCompare(b.lotId))
  return {
    asOf,
    lines,
    totalOnHand: round2(lines.reduce((s, l) => s + l.onHand, 0)),
    totalValue: round2(lines.reduce((s, l) => s + l.value, 0)),
    uncosted: lines.filter((l) => l.unitCost == null).length,
    expiringSoon: lines.filter((l) => l.expiryState === 'soon').length,
    expired: lines.filter((l) => l.expiryState === 'expired').length,
  }
}

/** Unit cost of a bill line spread over the units received: 12,000 for 200 pcs → 60.00. */
export function unitCostFromBillLine(lineAmount: number, quantity: number): number {
  if (!(quantity > 0)) throw new Error('quantity must be positive')
  return Math.round((lineAmount / quantity) * 10000) / 10000
}

/**
 * The product's `shelf_life_months` (a custom field on `catalog:catalog_product`,
 * declared in `orva/ce.ts`) for a variant, or null when the product has none.
 *
 * Read by SQL on `custom_field_values`, the precedent `orva_finance/lib/
 * reportQueries.ts` set for `th_tax_id`. The framework's `loadCustomFieldValues`
 * returned nothing for rows that demonstrably exist when called inside the
 * running app (the G3 rehearsal proved the rows with a direct query while the
 * loader and the products list both showed null); the plain column read is
 * what Orva can stand behind.
 */
export async function shelfLifeMonthsFor(
  tem: EntityManager,
  scope: { tenantId: string; organizationId: string },
  catalogVariantId: string,
): Promise<number | null> {
  const rows = (await tem.execute(
    `select v.value_int, v.value_text
       from catalog_product_variants pv
       join custom_field_values v
         on v.record_id = pv.product_id::text
        and v.entity_id = 'catalog:catalog_product'
        and v.field_key = 'shelf_life_months'
        and v.deleted_at is null
        and v.tenant_id = ?::uuid
      where pv.id = ?::uuid and pv.tenant_id = ?::uuid and pv.deleted_at is null
      order by v.created_at desc
      limit 1`,
    [scope.tenantId, catalogVariantId, scope.tenantId],
  )) as Array<{ value_int: number | string | null; value_text: string | null }>
  const raw = rows[0]?.value_int ?? rows[0]?.value_text ?? null
  const months = raw == null ? NaN : Number(raw)
  return Number.isInteger(months) && months > 0 ? months : null
}

/** Expiry date from a receipt date and the product's shelf life in months. */
export function expiryFromShelfLife(receivedOn: string, shelfLifeMonths: number): string {
  const [y, m, d] = receivedOn.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1 + shelfLifeMonths, d))
  // clamp when the target month is shorter (31 Jan + 1 month → 28/29 Feb)
  if (date.getUTCDate() !== d) date.setUTCDate(0)
  return date.toISOString().slice(0, 10)
}

export type CogsLine = { accountId: string; debit: string; credit: string; description: string }

/** Dr COGS / Cr Inventory for the month's issues, one balanced pair. */
export function buildCogsJournalLines(issues: Array<{ quantity: number; unitCost: number }>, cogsAccountId: string, inventoryAccountId: string): { lines: CogsLine[]; total: number } {
  if (!cogsAccountId || !inventoryAccountId) throw new Error('orva_stock: inventory and COGS accounts are not configured')
  const total = round2(issues.reduce((s, i) => s + i.quantity * i.unitCost, 0))
  if (!(total > 0)) throw new Error('orva_stock: nothing to post')
  return {
    total,
    lines: [
      { accountId: cogsAccountId, debit: total.toFixed(4), credit: '0.0000', description: 'ต้นทุนขายสินค้า' },
      { accountId: inventoryAccountId, debit: '0.0000', credit: total.toFixed(4), description: 'ตัดสินค้าคงเหลือ' },
    ],
  }
}

/** Retail price math: shelf price includes 7% VAT; the invoice needs the split. */
export function splitVatInclusive(grossTotal: number, vatRate = 7): { net: number; vat: number; gross: number } {
  const gross = round2(grossTotal)
  const net = round2(gross / (1 + vatRate / 100))
  return { net, vat: round2(gross - net), gross }
}
