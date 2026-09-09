import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'

/**
 * Optional seam to stock, for the lot label.
 *
 * A ฉลากล็อต is printed on the same rails as every other sheet — preview,
 * print, PDF, brand mark — but the lot lives in WMS and the cost in
 * `orva_stock`, neither of which this module imports: documents must keep
 * working with stock unregistered, and the two ship independently. So stock
 * registers a reader in DI and this module resolves it softly, exactly as it
 * does for the purchase order.
 *
 * The reader returns facts, not a sheet: what the lot is, what product it
 * holds, and what the variant's code is. `buildPrintableDocument` turns those
 * into labels and needs no stock knowledge at all.
 */
export type LotLabelData = {
  lot: {
    id: string
    lotNumber: string | null
    /** YYYY-MM-DD */
    manufacturedOn: string | null
    /** YYYY-MM-DD */
    expiresOn: string | null
  }
  product: {
    title: string
    /** e.g. "200 มล." — the product's subtitle, or the variant's name. */
    packSize: string | null
    /** เลขที่ใบรับจดแจ้ง (อย.), 10 digits. Null prints as a visible gap, never invented. */
    fdaNotification: string | null
    /** Document-brand code (e.g. MRV) — selects the brand mark and name. */
    brandCode: string | null
  }
  variant: {
    sku: string | null
    barcode: string | null
    gtinType: string | null
  }
}

export type StockLabelSource = {
  findLot: (
    em: EntityManager,
    scope: { tenantId: string; organizationId: string },
    lotId: string,
  ) => Promise<LotLabelData | null>
}

export const ORVA_STOCK_LABEL_SOURCE = 'orvaStockLabelSource' as const

export function resolveStockLabelSource(container: AppContainer): StockLabelSource | null {
  const probe = container as unknown as { hasRegistration?: (name: string) => boolean }
  if (typeof probe.hasRegistration !== 'function' || !probe.hasRegistration(ORVA_STOCK_LABEL_SOURCE)) return null
  try {
    return container.resolve<StockLabelSource>(ORVA_STOCK_LABEL_SOURCE)
  } catch {
    return null
  }
}
