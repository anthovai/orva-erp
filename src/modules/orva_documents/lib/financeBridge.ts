import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'

/**
 * Optional seam to the ledger. orva_finance registers 'orvaFinanceBridge' in
 * DI; when the module is not installed the documents flow simply reports
 * "not connected" and carries on — issuing paper never depends on the books.
 */
export type FinanceBridgeResult =
  | { ok: true; journalNo: string; receiptNo?: string | null }
  | { ok: false; reason: string }

export type FinanceScope = { tenantId: string; organizationId: string; userId: string | null }

export type FinanceBridge = {
  postInvoice: (em: EntityManager, scope: FinanceScope, args: { invoiceId: string; date: string }) => Promise<FinanceBridgeResult>
  recordReceipt: (
    em: EntityManager,
    scope: FinanceScope,
    args: { invoiceId: string; date: string; cashReceived: number; wht: number; note?: string | null },
  ) => Promise<FinanceBridgeResult>
}

export function resolveFinanceBridge(container: AppContainer): FinanceBridge | null {
  const probe = container as unknown as { hasRegistration?: (name: string) => boolean }
  if (typeof probe.hasRegistration !== 'function' || !probe.hasRegistration('orvaFinanceBridge')) return null
  try {
    return container.resolve<FinanceBridge>('orvaFinanceBridge')
  } catch {
    return null
  }
}
