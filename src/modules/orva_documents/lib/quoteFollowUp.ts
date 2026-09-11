/**
 * Whether a quote is waiting on the customer or on us.
 *
 * The gap this closes: a quote goes out and then nothing happens. The system
 * knew the quote was open, but not whether anybody had chased it — so the
 * owner could not tell "sent yesterday, give them time" from "sent three
 * weeks ago, they have forgotten". `orva_documents_sends` already records
 * every document actually emailed, which is the missing half.
 *
 * Pure: no database, no clock of its own. `today` is passed in so the same
 * inputs always give the same verdict, in tests and in the request.
 */

/**
 * How long a quote may sit unanswered before it becomes work.
 *
 * A week is the default because that is the rhythm of a small Thai B2B sale:
 * long enough not to nag, short enough that the customer still remembers the
 * conversation. A per-tenant setting belongs here eventually (Phase I, A8);
 * until a second tenant disagrees, one number is honest.
 */
export const FOLLOW_UP_AFTER_DAYS = 7

/** A quote never sent is not yet late on the day it is written. */
export const NUDGE_UNSENT_AFTER_DAYS = 2

/** Close enough to the expiry date that chasing is now urgent. */
export const EXPIRING_WITHIN_DAYS = 3

export type FollowUpState =
  /** Written but never emailed to the customer. */
  | 'never_sent'
  /** Sent recently; the ball is with the customer and it is too early to push. */
  | 'waiting'
  /** Sent long enough ago that it is worth asking. */
  | 'due'
  /** The validity date is about to pass. */
  | 'expiring'
  /** The validity date has passed. */
  | 'expired'

export type FollowUp = {
  state: FollowUpState
  lastSentOn: string | null
  /** Days since the last send, null when it was never sent. */
  daysSinceSent: number | null
  /** How many times the quote has been emailed. */
  sendCount: number
  /** Days until validUntil; negative once it has passed, null without a date. */
  daysToExpiry: number | null
  /** True when the row deserves the owner's attention today. */
  actionable: boolean
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.round((b - a) / 86_400_000)
}

export function quoteFollowUp(args: {
  /** When the quote was written, `YYYY-MM-DD`. */
  createdOn: string
  /** The quote's validity date, or null when it carries none. */
  validUntil: string | null
  /** Dates the quote was emailed, `YYYY-MM-DD`, any order. */
  sentDates: readonly string[]
  today: string
}): FollowUp {
  const sorted = [...args.sentDates].filter(Boolean).sort()
  const lastSentOn = sorted.length ? sorted[sorted.length - 1] : null
  const daysSinceSent = lastSentOn ? daysBetween(lastSentOn, args.today) : null
  const daysToExpiry = args.validUntil ? daysBetween(args.today, args.validUntil) : null

  // Expiry outranks the cadence: a quote that dies on Friday is worth a call
  // today even if it went out yesterday.
  let state: FollowUpState
  if (daysToExpiry != null && daysToExpiry < 0) state = 'expired'
  else if (daysToExpiry != null && daysToExpiry <= EXPIRING_WITHIN_DAYS) state = 'expiring'
  else if (!lastSentOn) state = daysBetween(args.createdOn, args.today) >= NUDGE_UNSENT_AFTER_DAYS ? 'never_sent' : 'waiting'
  else if ((daysSinceSent ?? 0) >= FOLLOW_UP_AFTER_DAYS) state = 'due'
  else state = 'waiting'

  return {
    state,
    lastSentOn,
    daysSinceSent,
    sendCount: sorted.length,
    daysToExpiry,
    actionable: state !== 'waiting',
  }
}
