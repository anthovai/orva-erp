/**
 * The one thing the owner should see each weekday morning.
 *
 * Deliberately does NOT cover overdue invoices: the reminder scan already
 * raises those one by one, with the amount and the days, which is more useful
 * than a count. This covers what nothing else notifies about — filings coming
 * due, clients waiting on a reply, licences lapsing, quotes about to expire,
 * and work accepted but not yet billed.
 *
 * Pure, so what counts as "needs attention" is unit-tested rather than
 * discovered in production.
 */

/** Filing deadlines closer than this are worth waking someone for. */
export const TAX_HORIZON_DAYS = 10
/** A quote this close to expiry needs chasing or extending. */
export const QUOTE_HORIZON_DAYS = 7

export type BriefInput = {
  tax: ReadonlyArray<{
    /** Days until the paper deadline; negative once past it. */
    daysLeft: number
    /** Set once the month pack went to the accountant — then it is handled. */
    packSentAt: string | null
    /** '0.00' filings still must be filed, so the amount does not gate this. */
    amount: string
  }>
  /** Open tickets we have never replied to. */
  ticketsAwaitingReply: number
  /** Open tickets past their due date. */
  ticketsOverdue: number
  /** Licences/domains already past renewal. */
  lapsedSubscriptions: number
  /** Licences/domains renewing inside the register's lead window. */
  renewingSubscriptions: number
  /** Quotes still awaiting the customer, with days until they expire. */
  quotes: ReadonlyArray<{ daysLeft: number | null }>
  /** Quotes the customer accepted with no งวด issued yet. */
  acceptedAwaitingInstallment: number
}

export type BriefCounts = {
  tax: number
  tickets: number
  renewals: number
  quotes: number
  installments: number
}

export type Brief = {
  counts: BriefCounts
  /** Everything the brief is about, so the caller can title it. */
  total: number
  /** Categories that actually have something, in the order they should read. */
  present: Array<{ key: keyof BriefCounts; count: number }>
}

/** Fixed reading order: money and deadlines before housekeeping. */
const ORDER: Array<keyof BriefCounts> = ['tax', 'installments', 'tickets', 'quotes', 'renewals']

/**
 * Returns null when there is nothing to say.
 *
 * A daily "all clear" would be the right call for an email digest — silence
 * would then be indistinguishable from a broken job. But this is delivered as
 * an in-app notification, and lighting the bell every morning for nothing is
 * how a badge gets ignored. When the email channel exists, send that one
 * unconditionally and keep this one quiet.
 */
export function composeBrief(input: BriefInput): Brief | null {
  const tax = input.tax.filter(
    (filing) => filing.packSentAt == null && filing.daysLeft <= TAX_HORIZON_DAYS,
  ).length

  const quotes = input.quotes.filter(
    (quote) => quote.daysLeft != null && quote.daysLeft <= QUOTE_HORIZON_DAYS,
  ).length

  const counts: BriefCounts = {
    tax,
    tickets: input.ticketsAwaitingReply + input.ticketsOverdue,
    renewals: input.lapsedSubscriptions + input.renewingSubscriptions,
    quotes,
    installments: input.acceptedAwaitingInstallment,
  }
  const total = counts.tax + counts.tickets + counts.renewals + counts.quotes + counts.installments
  if (total === 0) return null
  // Only what is actually pending: a line reading "ภาษี 2 · ซัพพอร์ต 0 · ต่ออายุ 0"
  // buries the one number that matters under four that do not.
  const present = ORDER.filter((key) => counts[key] > 0).map((key) => ({ key, count: counts[key] }))
  return { counts, total, present }
}
