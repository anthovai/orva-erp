import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { findOrderDocument } from './lib/documentSource'

/**
 * How a ใบสั่งซื้อ reaches the printing rails without orva_documents having to
 * know this module exists.
 *
 * Registered as a VALUE of functions taking the caller's EntityManager: the
 * document module already holds the request-scoped one and passing it
 * explicitly sidesteps cradle-injection differences between container scopes
 * — the same shape orva_finance uses for its ledger bridge.
 */
export const ORVA_PURCHASING_DOCUMENT_SOURCE = 'orvaPurchasingDocumentSource' as const

export function register(container: AppContainer) {
  container.register({
    [ORVA_PURCHASING_DOCUMENT_SOURCE]: asValue({
      findOrder: findOrderDocument,
    }),
  })
}
