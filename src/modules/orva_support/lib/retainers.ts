import { daysUntil, type BillingCycle } from './subscriptions'

/**
 * Which retainers are due to be billed, decided without touching the
 * database so the rule is readable and unit-tested.
 *
 * A retainer is a maintenance fee the customer pays us each cycle. Unlike the
 * software register's other lines — bills WE pay — this one produces an
 * invoice, so the rule is deliberately conservative: only an active line, only
 * with the toggle on, only with a customer and a project to bill against, only
 * once per cycle (a line already invoiced on or after the cycle's start is
 * left alone), and only when the renewal date has arrived.
 */

export type RetainerLike = {
  id: string
  name: string
  status: string
  invoiceOnRenewal: boolean
  renewsOn: string | null
  billingCycle: BillingCycle
  customerEntityId: string | null
  quoteId: string | null
  /** What to bill; falls back to the line's cost. */
  retainerAmount: number | null
  cost: number
  /** ISO date of the last retainer invoice issued for this line. */
  lastInvoicedOn: string | null
}

export type RetainerVerdict =
  | { due: true; amount: number }
  | { due: false; reason: 'not_retainer' | 'cancelled' | 'no_date' | 'not_yet' | 'already_invoiced' | 'no_customer' | 'no_amount' }

/**
 * The amount this cycle bills: the retainer amount when it is set to
 * something billable, else the line's cost. A stored zero counts as "not
 * set" — the column defaults to nothing and nobody bills a customer ฿0.
 */
export function retainerAmountOf(row: Pick<RetainerLike, 'retainerAmount' | 'cost'>): number {
  const chosen = row.retainerAmount != null && row.retainerAmount > 0 ? row.retainerAmount : row.cost
  return Number.isFinite(chosen) && chosen > 0 ? Math.round(chosen * 100) / 100 : 0
}

export function retainerVerdict(row: RetainerLike, today: string): RetainerVerdict {
  if (!row.invoiceOnRenewal) return { due: false, reason: 'not_retainer' }
  if (row.status !== 'active') return { due: false, reason: 'cancelled' }
  if (!row.renewsOn) return { due: false, reason: 'no_date' }
  if (!row.customerEntityId || !row.quoteId) return { due: false, reason: 'no_customer' }
  if (daysUntil(row.renewsOn, today) > 0) return { due: false, reason: 'not_yet' }
  // One invoice per cycle: the renewal date is the cycle's start, so anything
  // invoiced on or after it has already been billed for this cycle.
  if (row.lastInvoicedOn && daysUntil(row.renewsOn, row.lastInvoicedOn) <= 0) return { due: false, reason: 'already_invoiced' }
  const amount = retainerAmountOf(row)
  if (!amount) return { due: false, reason: 'no_amount' }
  return { due: true, amount }
}

/** Only the lines the owner should be asked about today. */
export function retainersDue(rows: RetainerLike[], today: string): Array<{ row: RetainerLike; amount: number }> {
  return rows.flatMap((row) => {
    const verdict = retainerVerdict(row, today)
    return verdict.due ? [{ row, amount: verdict.amount }] : []
  })
}

/** One notification per retainer per due date — a re-run cannot nag twice. */
export const retainerGroupKey = (id: string, renewsOn: string) => `orva_support.retainer:${id}:${renewsOn}`
