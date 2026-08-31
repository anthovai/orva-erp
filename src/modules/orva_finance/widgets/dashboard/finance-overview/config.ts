export type FinanceOverviewSettings = {
  /** Reporting window for the P&L half of the widget. */
  range: 'month' | 'quarter' | 'year'
}

export const DEFAULT_SETTINGS: FinanceOverviewSettings = { range: 'month' }

export function hydrateFinanceOverviewSettings(raw: unknown): FinanceOverviewSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS }
  const input = raw as Partial<FinanceOverviewSettings>
  const range = input.range === 'quarter' || input.range === 'year' || input.range === 'month'
    ? input.range
    : DEFAULT_SETTINGS.range
  return { range }
}

/** Inclusive [from, to] for the selected window, in the tenant's local dates. */
export function resolveRangeDates(range: FinanceOverviewSettings['range'], now = new Date()): { from: string; to: string } {
  const iso = (date: Date) => date.toISOString().slice(0, 10)
  const year = now.getFullYear()
  const month = now.getMonth()
  if (range === 'year') return { from: iso(new Date(Date.UTC(year, 0, 1))), to: iso(new Date(Date.UTC(year, 11, 31))) }
  if (range === 'quarter') {
    const firstMonthOfQuarter = Math.floor(month / 3) * 3
    return {
      from: iso(new Date(Date.UTC(year, firstMonthOfQuarter, 1))),
      to: iso(new Date(Date.UTC(year, firstMonthOfQuarter + 3, 0))),
    }
  }
  return { from: iso(new Date(Date.UTC(year, month, 1))), to: iso(new Date(Date.UTC(year, month + 1, 0))) }
}
