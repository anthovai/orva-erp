/**
 * Pure renewal rules for the software/subscription register. A licence that
 * lapses quietly is how a client's site goes down before we notice, so the
 * register's whole job is turning a renewal date into "how many days left"
 * and a run-rate we can budget for. IO-free so the arithmetic is unit-tested.
 */
export type BillingCycle = 'monthly' | 'quarterly' | 'yearly' | 'one_time'
export type RenewalState = 'lapsed' | 'due_soon' | 'upcoming'

/** Days a renewal is flagged before it falls due — a month's warning on annual bills. */
export const DEFAULT_LEAD_DAYS = 30

const MONTHS_PER_CYCLE: Record<BillingCycle, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
  one_time: 0,
}

const parts = (iso: string) => [Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), Number(iso.slice(8, 10))] as const
const utc = (iso: string) => { const [y, m, d] = parts(iso); return Date.UTC(y, m - 1, d) }

/**
 * Adds whole months, clamping to the end of the target month — a 31 Jan
 * renewal moves to 28 Feb, not 3 March.
 */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = parts(iso)
  const target = new Date(Date.UTC(y, m - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  const day = String(Math.min(d, lastDay)).padStart(2, '0')
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${day}`
}

/** Whole days from `today` to the renewal — negative once it has lapsed. */
export function daysUntil(renewsOn: string, today: string): number {
  return Math.round((utc(renewsOn) - utc(today)) / 864e5)
}

export function renewalState(renewsOn: string, today: string, leadDays = DEFAULT_LEAD_DAYS): RenewalState {
  const days = daysUntil(renewsOn, today)
  if (days < 0) return 'lapsed'
  return days <= leadDays ? 'due_soon' : 'upcoming'
}

/**
 * The renewal date after paying: one cycle on, rolled forward past `today` so
 * settling a licence that lapsed months ago lands in the future rather than
 * still overdue. `one_time` has no next date — cancel it instead.
 */
export function nextRenewal(renewsOn: string, cycle: BillingCycle, today: string): string | null {
  const step = MONTHS_PER_CYCLE[cycle]
  if (!step) return null
  let next = addMonths(renewsOn, step)
  // A lapsed annual licence needs at most a handful of hops; the cap only
  // guards against a corrupt date, never normal use.
  for (let i = 0; i < 200 && utc(next) <= utc(today); i += 1) next = addMonths(next, step)
  return next
}

/** What this line costs per year — the number that belongs in a budget. */
export function annualisedCost(cost: number, cycle: BillingCycle): number {
  const step = MONTHS_PER_CYCLE[cycle]
  if (!step) return 0
  return Math.round(cost * (12 / step) * 100) / 100
}

export type SubscriptionSummary = {
  /** active lines whose renewal date has passed */
  lapsed: number
  /** active lines renewing within the lead window */
  dueSoon: number
  /** yearly run-rate of every active line */
  annualTotal: number
}

export function summarise(
  rows: Array<{ renewsOn: string | null; cycle: BillingCycle; cost: number; status: string }>,
  today: string,
  leadDays = DEFAULT_LEAD_DAYS,
): SubscriptionSummary {
  let lapsed = 0
  let dueSoon = 0
  let annualTotal = 0
  for (const row of rows) {
    if (row.status !== 'active') continue
    annualTotal += annualisedCost(row.cost, row.cycle)
    if (!row.renewsOn) continue
    const state = renewalState(row.renewsOn, today, leadDays)
    if (state === 'lapsed') lapsed += 1
    else if (state === 'due_soon') dueSoon += 1
  }
  return { lapsed, dueSoon, annualTotal: Math.round(annualTotal * 100) / 100 }
}
