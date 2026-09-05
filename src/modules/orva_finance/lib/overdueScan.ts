import { reminderState, type ReminderState } from './reminders'

/**
 * Which overdue invoices the daily scan should raise today.
 *
 * Kept separate from the worker so the selection — the part that decides
 * whether a client gets chased — is unit-tested without a queue, a database
 * or a clock. The worker only turns this list into notifications.
 */

export type ScanInvoice = {
  id: string
  invoiceNumber: string
  customerName: string | null
  /** Outstanding gross amount. */
  remaining: number
  dueDate: string | null
  /** ISO dates the invoice or its tax invoice was emailed, any order. */
  reminderDates: readonly string[]
}

export type ScanHit = ScanInvoice & {
  state: ReminderState
  /** Stable per invoice per day, so re-running the scan cannot double-notify. */
  groupKey: string
}

export const REMINDER_GROUP_PREFIX = 'orva_finance.invoice.reminder_due'

/**
 * A hit is an invoice that is overdue past the threshold, still owed, and
 * either never chased or quiet long enough to chase again — the same cadence
 * the home screen shows, so the two can never disagree.
 *
 * Sorted by amount so that when several are due at once, the one worth the
 * most is the one the owner sees first.
 */
export function invoicesDueForReminder(invoices: readonly ScanInvoice[], today: string): ScanHit[] {
  return invoices
    .filter((invoice) => invoice.remaining > 0.005)
    .map((invoice) => ({
      ...invoice,
      state: reminderState({ dueDate: invoice.dueDate, reminderDates: invoice.reminderDates }, today),
      groupKey: `${REMINDER_GROUP_PREFIX}:${invoice.id}:${today}`,
    }))
    .filter((hit) => hit.state.dueForReminder)
    .sort((a, b) => b.remaining - a.remaining)
}
