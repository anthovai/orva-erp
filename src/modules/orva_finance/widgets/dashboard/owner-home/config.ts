export type OwnerHomeSettings = {
  /** Show the per-invoice list under "money due in" or just the totals. */
  showInvoiceList: boolean
}

export const DEFAULT_SETTINGS: OwnerHomeSettings = { showInvoiceList: true }

export function hydrateOwnerHomeSettings(raw: unknown): OwnerHomeSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const input = raw as Partial<OwnerHomeSettings>
  return { showInvoiceList: input.showInvoiceList !== false }
}
