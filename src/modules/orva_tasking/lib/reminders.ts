import { addDays } from './timeline'

/**
 * When a reminder is due, and whether it has already been raised.
 *
 * Pure functions over plain values, so the rules can be read and tested
 * without a database or a clock. The worker supplies "now"; nothing here calls
 * `Date.now()`.
 */

export type ReminderAnchor = 'due' | 'start' | 'end'

export type ReminderRow = {
  id: string
  taskId: string
  /** An absolute moment, ISO. Mutually exclusive with the relative pair. */
  remindAt: string | null
  relativeTo: ReminderAnchor | null
  /** Minutes before the anchor date; negative means after it. */
  relativeMinutes: number | null
  lastFiredAt: string | null
}

export type ReminderTask = {
  id: string
  dueOn: string | null
  startDate: string | null
  endDate: string | null
  done: boolean
}

/**
 * The moment a reminder points at, or null when it points at nothing.
 *
 * A relative reminder whose anchor date is not set has no moment — and rather
 * than guessing one, it simply never fires. Dates are treated as 09:00 in the
 * tenant's own morning, because "remind me the day before" means the morning
 * before, not midnight.
 */
export function reminderMoment(
  reminder: ReminderRow,
  task: ReminderTask,
  anchorHour = 9,
): Date | null {
  if (reminder.remindAt) return new Date(reminder.remindAt)
  if (!reminder.relativeTo || reminder.relativeMinutes === null) return null
  const anchorDate =
    reminder.relativeTo === 'due' ? task.dueOn
    : reminder.relativeTo === 'start' ? task.startDate
    : task.endDate
  if (!anchorDate) return null
  const base = new Date(`${anchorDate}T00:00:00.000Z`)
  base.setUTCHours(anchorHour)
  return new Date(base.getTime() - reminder.relativeMinutes * 60_000)
}

/**
 * Reminders that should be raised now.
 *
 * A finished task never reminds anyone — the whole point of ticking it off.
 * Anything already fired stays quiet, which is what keeps a re-run, a retry
 * and a second tick of the schedule from nagging three times.
 */
export function remindersDueNow(
  reminders: ReminderRow[],
  tasks: Map<string, ReminderTask>,
  now: Date,
): ReminderRow[] {
  return reminders.filter((reminder) => {
    if (reminder.lastFiredAt) return false
    const task = tasks.get(reminder.taskId)
    if (!task || task.done) return false
    const moment = reminderMoment(reminder, task)
    return moment !== null && moment.getTime() <= now.getTime()
  })
}

export type RepeatTask = {
  id: string
  dueOn: string | null
  startDate: string | null
  endDate: string | null
  repeatEveryDays: number | null
  repeatMode: 'from_due' | 'from_completion' | null
  /** The date the task was ticked off, `YYYY-MM-DD`. */
  doneOn: string | null
}

export type Occurrence = {
  /** Identifies this occurrence, so creating it twice is impossible. */
  occurrence: string
  dueOn: string | null
  startDate: string | null
  endDate: string | null
}

/**
 * The next occurrence of a completed repeating task, or null when there is
 * none to make.
 *
 * `from_due` keeps the original rhythm — a weekly report stays on its day even
 * if it went out late. `from_completion` measures from when the work actually
 * finished, which is what "every 30 days after servicing" means.
 *
 * Every date the task carried moves by the same number of days, so a task that
 * spans a week still spans a week next time.
 */
export function nextOccurrence(task: RepeatTask): Occurrence | null {
  const every = task.repeatEveryDays
  if (!every || every <= 0 || !task.repeatMode) return null

  const anchor = task.dueOn ?? task.endDate ?? task.startDate
  if (!anchor) return null

  const from = task.repeatMode === 'from_completion' ? (task.doneOn ?? anchor) : anchor
  const shift = daysBetween(anchor, from) + every
  const move = (date: string | null) => (date ? addDays(date, shift) : null)

  const nextDue = move(task.dueOn)
  const nextEnd = move(task.endDate)
  const nextStart = move(task.startDate)
  const occurrence = nextDue ?? nextEnd ?? nextStart
  if (!occurrence) return null

  return { occurrence, dueOn: nextDue, startDate: nextStart, endDate: nextEnd }
}

function daysBetween(from: string, to: string): number {
  const u = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
  return Math.round((u(to) - u(from)) / 864e5)
}
