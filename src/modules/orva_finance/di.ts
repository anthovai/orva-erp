import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { postInvoiceToLedger, recordReceiptForInvoice } from './lib/bridge'

/**
 * DI token other app modules may resolve OPTIONALLY (`container.hasRegistration`)
 * to reach the ledger without importing finance internals — the sanctioned
 * cross-module seam (IDs + optional DI, no ORM relations).
 *
 * Registered as a VALUE of functions that take the caller's EntityManager:
 * the caller already holds the request-scoped em, and passing it explicitly
 * sidesteps cradle-injection differences between container scopes.
 */
export const ORVA_FINANCE_BRIDGE = 'orvaFinanceBridge' as const

export function register(container: AppContainer) {
  container.register({
    [ORVA_FINANCE_BRIDGE]: asValue({
      postInvoice: postInvoiceToLedger,
      recordReceipt: recordReceiptForInvoice,
    }),
  })
}
