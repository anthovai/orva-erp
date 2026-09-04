/**
 * Collection cadence: when an overdue invoice deserves another nudge.
 *
 * The owner chases payment by hand, one person against irregular clients, so
 * the system's job is not to send anything — it is to answer "which overdue
 * invoice have I not chased yet, and which one has gone quiet long enough to
 * chase again?". Send history comes from `orva_documents_sends`; nothing here
 * touches a mailbox.
 *
 * Pure and IO-free so the cadence is unit-tested rather than trusted.
 */

/** Days past the due date before the first nudge is suggested. */
export const FIRST_REMINDER_AFTER_DAYS = 3
/** Quiet days between nudges. */
export const REMINDER_INTERVAL_DAYS = 7
/** Stop suggesting after this many — beyond it, chasing is a phone call. */
export const MAX_REMINDERS = 3

const utc = (iso: string) =>
  Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / 864e5)
}

export type ReminderState = {
  /** Days past due; 0 when not yet due or no due date. */
  daysOverdue: number
  /** Reminders already emailed for this invoice. */
  remindersSent: number
  /** Days since the last reminder, or null when never reminded. */
  daysSinceReminder: number | null
  /** Overdue, unchased, and quiet long enough to chase again. */
  dueForReminder: boolean
  /** Overdue and never chased at all — the sharpest version of the signal. */
  neverReminded: boolean
  /** Chased the maximum number of times and still unpaid. */
  exhausted: boolean
}

export function reminderState(
  invoice: {
    /** ISO date, or null when the invoice carries no due date. */
    dueDate: string | null
    /** ISO dates of reminders already sent, any order. */
    reminderDates?: readonly string[]
  },
  today: string,
): ReminderState {
  const dates = [...(invoice.reminderDates ?? [])].sort()
  const remindersSent = dates.length
  const last = dates[dates.length - 1] ?? null
  const daysOverdue = invoice.dueDate ? Math.max(0, daysBetween(invoice.dueDate, today)) : 0
  const daysSinceReminder = last ? Math.max(0, daysBetween(last, today)) : null
  const overdueEnough = daysOverdue >= FIRST_REMINDER_AFTER_DAYS
  const exhausted = remindersSent >= MAX_REMINDERS
  // A reminder sent today (or in the future, from a clock skew) still counts as
  // quiet time not yet elapsed, so `>=` against the interval never fires on 0.
  const quietEnough = daysSinceReminder == null || daysSinceReminder >= REMINDER_INTERVAL_DAYS
  return {
    daysOverdue,
    remindersSent,
    daysSinceReminder,
    dueForReminder: overdueEnough && !exhausted && quietEnough,
    neverReminded: overdueEnough && remindersSent === 0,
    exhausted: exhausted && daysOverdue > 0,
  }
}

/**
 * The one line the owner reads next to an overdue invoice. Returns a token and
 * its substitution, so the caller localises — never a hard-coded string.
 */
export function reminderLabel(state: ReminderState):
  | { key: 'never'; days?: never }
  | { key: 'sent'; days: number }
  | { key: 'due'; days: number }
  | null {
  if (state.daysOverdue <= 0) return null
  if (state.remindersSent === 0) return state.neverReminded ? { key: 'never' } : null
  if (state.dueForReminder && state.daysSinceReminder != null) return { key: 'due', days: state.daysSinceReminder }
  return { key: 'sent', days: state.remindersSent }
}
