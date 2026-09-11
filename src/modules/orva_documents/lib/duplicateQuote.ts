import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesQuote } from '@open-mercato/core/modules/sales/data/entities'

/**
 * Copying a quote, as data.
 *
 * The business reason: this tenant sells variations of the same project, and
 * every quote was being retyped. Upstream's create form has no slot for a
 * catalogue picker and forking a 1,500-line component to add one would cost
 * more than it saves, so the reusable thing is the quote that was already
 * written.
 *
 * What travels: the customer, the currency and the lines. What does not: the
 * number (the new draft claims its own), the status (a copy starts as a
 * draft, never as sent or accepted), the acceptance token, the dates, and the
 * installments already issued — those belong to the quote that earned them.
 */

export type QuoteLineCopy = {
  kind?: string
  productId?: string
  productVariantId?: string
  name?: string
  description?: string
  quantity: string
  quantityUnit?: string
  currencyCode: string
  unitPriceNet?: string
  discountAmount?: string
  discountPercent?: string
  taxRate?: string
}

export type QuoteCopy = {
  currencyCode: string
  customerEntityId?: string
  customerContactId?: string
  customerSnapshot?: Record<string, unknown>
  comments?: string
  lines: QuoteLineCopy[]
}

type LineRow = {
  kind: string | null
  product_id: string | null
  product_variant_id: string | null
  name: string | null
  description: string | null
  quantity: string | null
  quantity_unit: string | null
  currency_code: string | null
  unit_price_net: string | null
  discount_amount: string | null
  discount_percent: string | null
  tax_rate: string | null
}

const text = (value: string | null | undefined): string | undefined => {
  const trimmed = (value ?? '').trim()
  return trimmed.length ? trimmed : undefined
}

/** A numeric column as a string the create schema accepts, or undefined when it is empty or zero-ish. */
const amount = (value: string | null | undefined): string | undefined => {
  if (value == null) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? String(parsed) : undefined
}

/**
 * Reads a quote and shapes the payload that creates its copy. Returns null
 * when the quote is not this tenant's, so the caller answers 404 without
 * leaking whether the id exists.
 */
export async function buildQuoteCopy(
  tem: EntityManager,
  scope: { tenantId: string; organizationId: string },
  quoteId: string,
): Promise<QuoteCopy | null> {
  const [quote] = await findWithDecryption(
    tem, SalesQuote,
    { id: quoteId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    { limit: 1 },
    { tenantId: scope.tenantId },
  )
  if (!quote) return null

  const rows = (await tem.execute(
    `select kind, product_id::text, product_variant_id::text, name, description,
            quantity::text, quantity_unit, currency_code, unit_price_net::text,
            discount_amount::text, discount_percent::text, tax_rate::text
     from sales_quote_lines
     where quote_id = ?::uuid and tenant_id = ?::uuid and deleted_at is null
     order by line_number, created_at`,
    [quoteId, scope.tenantId],
  )) as LineRow[]

  const currencyCode = quote.currencyCode || 'THB'
  const snapshot = quote.customerSnapshot as Record<string, unknown> | null | undefined

  return {
    currencyCode,
    customerEntityId: quote.customerEntityId ?? undefined,
    customerContactId: quote.customerContactId ?? undefined,
    // The snapshot is what the printed sheet reads, so a copy that keeps the
    // customer must keep it; without one the new quote would print blank
    // until somebody re-picked the same customer.
    customerSnapshot: snapshot && Object.keys(snapshot).length ? snapshot : undefined,
    comments: text(quote.comments),
    lines: rows.map((row) => ({
      kind: text(row.kind),
      productId: text(row.product_id),
      productVariantId: text(row.product_variant_id),
      name: text(row.name),
      description: text(row.description),
      quantity: amount(row.quantity) ?? '1',
      quantityUnit: text(row.quantity_unit),
      currencyCode: text(row.currency_code) ?? currencyCode,
      unitPriceNet: amount(row.unit_price_net),
      discountAmount: amount(row.discount_amount),
      discountPercent: amount(row.discount_percent),
      taxRate: amount(row.tax_rate),
    })),
  }
}
