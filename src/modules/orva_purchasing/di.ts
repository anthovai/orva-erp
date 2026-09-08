import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { findOrderDocument } from './lib/documentSource'
import { purchasingSummary } from './lib/summary'

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

/**
 * The home screen reads purchasing's two figures through this rather than the
 * summary route, so the four questions still render when this module is not
 * registered at all — orva_finance resolves it softly and omits the rows.
 *
 * It takes the caller's EntityManager, which means it runs inside the home
 * overview's own RLS transaction: the tenant is enforced by the database for
 * these reads too, not only by the filters.
 */
export const ORVA_PURCHASING_SUMMARY = 'orvaPurchasingSummary' as const

export function register(container: AppContainer) {
  container.register({
    [ORVA_PURCHASING_DOCUMENT_SOURCE]: asValue({
      findOrder: findOrderDocument,
    }),
    [ORVA_PURCHASING_SUMMARY]: asValue({
      summarise: purchasingSummary,
    }),
  })
}
