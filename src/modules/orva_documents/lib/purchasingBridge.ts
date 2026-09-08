import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { DocumentSource, Party } from './document'

/**
 * Optional seam to purchasing.
 *
 * A ใบสั่งซื้อ is printed on the same rails as every other sheet, but its
 * record lives in `orva_purchasing`, which this module must not import: the
 * document module has to keep working when purchasing is not registered, and
 * the two ship independently. So purchasing registers a reader in DI and this
 * module resolves it softly — absent, the type simply reports itself
 * unavailable instead of failing the whole preview.
 *
 * The reader returns the same `DocumentSource` every other record produces
 * plus the counterparty, so `buildPrintableDocument` needs no purchasing
 * knowledge at all.
 */
export type PurchaseOrderDocument = {
  source: DocumentSource
  /** The vendor: the party that RECEIVES this document. */
  counterparty: Party
  status: string
}

export type PurchasingDocumentSource = {
  findOrder: (
    em: EntityManager,
    scope: { tenantId: string; organizationId: string },
    orderId: string,
  ) => Promise<PurchaseOrderDocument | null>
}

export const ORVA_PURCHASING_DOCUMENT_SOURCE = 'orvaPurchasingDocumentSource' as const

export function resolvePurchasingDocumentSource(container: AppContainer): PurchasingDocumentSource | null {
  const probe = container as unknown as { hasRegistration?: (name: string) => boolean }
  if (typeof probe.hasRegistration !== 'function' || !probe.hasRegistration(ORVA_PURCHASING_DOCUMENT_SOURCE)) return null
  try {
    return container.resolve<PurchasingDocumentSource>(ORVA_PURCHASING_DOCUMENT_SOURCE)
  } catch {
    return null
  }
}
