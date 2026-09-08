import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'

/**
 * Optional seam to purchasing.
 *
 * The home screen shows two purchasing facts — money promised and not billed,
 * goods promised and not arrived — but finance must not import purchasing:
 * the four questions have to render on an install that never registered it.
 * So purchasing publishes the reader in DI and this resolves it softly. Absent,
 * the rows are simply omitted, which is the honest degradation: no purchasing
 * module means no purchase orders to be late.
 *
 * Same shape as `orva_documents/lib/purchasingBridge.ts` uses for the sheet.
 */
export type PurchasingLateLine = {
  orderId: string
  poNumber: string | null
  lineId: string
  lineNo: number
  description: string
  vendorName: string
  unit: string | null
  orderedQty: number
  receivedQty: number
  remainingQty: number
  expectedOn: string
  daysLate: number
}

export type PurchasingSummaryResult = {
  committedNotBilled: number
  lateLines: PurchasingLateLine[]
  lateCount: number
}

export type PurchasingSummaryReader = {
  summarise: (
    em: EntityManager,
    scope: { tenantId: string; organizationId: string },
    today: string,
  ) => Promise<PurchasingSummaryResult>
}

export const ORVA_PURCHASING_SUMMARY = 'orvaPurchasingSummary' as const

export function resolvePurchasingSummary(container: AppContainer): PurchasingSummaryReader | null {
  const probe = container as unknown as { hasRegistration?: (name: string) => boolean }
  if (typeof probe.hasRegistration !== 'function' || !probe.hasRegistration(ORVA_PURCHASING_SUMMARY)) return null
  try {
    return container.resolve<PurchasingSummaryReader>(ORVA_PURCHASING_SUMMARY)
  } catch {
    return null
  }
}
