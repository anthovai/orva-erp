import type { DeliveryBlock } from './document'

/**
 * Merging delivery facts into an invoice's metadata.
 *
 * Pure, because the risk here is not the write — it is losing something that
 * was already in `metadata`. The invoice's own `quoteId`, `customerSnapshot`,
 * `paidDate` and the rest live in the same column, so the rule is: keep every
 * key, replace only `delivery`, and never store a person's name (Q-004 —
 * `sales_invoices.metadata` is plaintext at rest).
 */

export type DeliveryFactsInput = {
  deliveredOn?: string | null
  carrier?: string | null
  trackingNumbers?: string[]
  address?: string | null
  note?: string | null
  showPrices?: boolean
}

/** What is actually persisted under `metadata.delivery`. */
export type StoredDelivery = {
  deliveredOn: string | null
  carrier: string | null
  trackingNumbers: string[]
  address: string | null
  note: string | null
  showPrices: boolean
}

/** Keys the store will accept. Anything else — `receiverName` above all — is refused. */
export const DELIVERY_FACT_KEYS = ['deliveredOn', 'carrier', 'trackingNumbers', 'address', 'note', 'showPrices'] as const

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)

/**
 * The facts as they will be stored, taking what the operator left blank from
 * what was recorded before. Editing only the tracking number must not erase
 * the delivery date somebody else typed this morning.
 *
 * A field absent from the payload keeps its stored value; a field sent as
 * null or as an empty string clears it. That distinction is the whole reason
 * this is a function rather than a spread.
 */
export function storedDeliveryFrom(existing: unknown, input: DeliveryFactsInput): StoredDelivery {
  const before = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? (existing as Record<string, unknown>)
    : {}
  const pick = (next: string | null | undefined, stored: unknown): string | null =>
    next === undefined ? text(stored) : text(next)
  return {
    deliveredOn: pick(input.deliveredOn, before.deliveredOn),
    carrier: pick(input.carrier, before.carrier),
    address: pick(input.address, before.address),
    note: pick(input.note, before.note),
    trackingNumbers:
      input.trackingNumbers === undefined
        ? Array.isArray(before.trackingNumbers)
          ? before.trackingNumbers.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
          : []
        : input.trackingNumbers.map((value) => value.trim()).filter((value) => value.length > 0),
    showPrices: input.showPrices === undefined ? before.showPrices === true : input.showPrices,
  }
}

/**
 * The whole metadata object to write back: every existing key, with
 * `delivery` replaced. Returns the object rather than writing it so the merge
 * can be tested without a database.
 */
export function mergeDeliveryFacts(
  metadata: unknown,
  input: DeliveryFactsInput,
): { metadata: Record<string, unknown>; delivery: StoredDelivery } {
  const existing = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {}
  const delivery = storedDeliveryFrom(existing.delivery, input)
  return { metadata: { ...existing, delivery }, delivery }
}

/** The block the sheet prints, from what was stored. Never carries a name. */
export function deliveryBlockFrom(stored: StoredDelivery): DeliveryBlock {
  return {
    deliveredOn: stored.deliveredOn,
    carrier: stored.carrier,
    trackingNumbers: stored.trackingNumbers,
    address: stored.address,
    note: stored.note,
  }
}
