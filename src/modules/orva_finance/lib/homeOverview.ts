/**
 * Pure date math for the owner's home screen: which month is "last month",
 * when its Thai filings fall due, and how far away a date is.
 *
 * Statutory deadlines (paper filing; e-filing adds 8 days, mentioned in the
 * UI hint rather than assumed):
 *   ภ.พ.30  (VAT)        — 15th of the following month
 *   ภ.ง.ด.3 / ภ.ง.ด.53 (WHT remittance) — 7th of the following month
 * Both slide to the next business day when they land on a weekend; public
 * holidays are not modelled (the owner sees "due" a day early at worst).
 */
export type TaxKind = 'vat' | 'wht'

export type TaxDeadline = {
  kind: TaxKind
  /** The month being filed, YYYY-MM. */
  period: string
  dueDate: string
  daysLeft: number
  state: 'upcoming' | 'due_soon' | 'overdue'
}

const pad = (n: number) => String(n).padStart(2, '0')

export function isoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

export function monthOf(date: string): string {
  return date.slice(0, 7)
}

/** '2026-09' → '2026-08' */
export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 2, 1))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
}

/** '2026-09' → '2026-10' */
export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 1))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
}

/** Inclusive first/last day of a YYYY-MM month. */
export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number)
  return { from: `${month}-01`, to: isoDate(new Date(Date.UTC(y, m, 0))) }
}

export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)))
  const b = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)))
  return Math.round((b - a) / 86_400_000)
}

function nextBusinessDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1)
  return isoDate(d)
}

export function statutoryDueDate(kind: TaxKind, period: string): string {
  const filingMonth = nextMonth(period)
  return nextBusinessDay(`${filingMonth}-${kind === 'vat' ? '15' : '07'}`)
}

/**
 * Deadlines worth showing today: last month's two filings, plus the month
 * before if its deadline is still within `graceDays` after passing (so an
 * overdue filing keeps nagging instead of vanishing on the 1st).
 */
export function upcomingDeadlines(today: string, graceDays = 45): TaxDeadline[] {
  const out: TaxDeadline[] = []
  const thisMonth = monthOf(today)
  for (const period of [previousMonth(previousMonth(thisMonth)), previousMonth(thisMonth)]) {
    for (const kind of ['wht', 'vat'] as TaxKind[]) {
      const dueDate = statutoryDueDate(kind, period)
      const daysLeft = daysBetween(today, dueDate)
      if (daysLeft < -graceDays) continue
      out.push({
        kind,
        period,
        dueDate,
        daysLeft,
        state: daysLeft < 0 ? 'overdue' : daysLeft <= 7 ? 'due_soon' : 'upcoming',
      })
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
}
