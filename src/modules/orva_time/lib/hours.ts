/**
 * Hours logged against a project, and how to say them.
 *
 * Phase 3 of the spec: read-only. Nothing here writes, and nothing here
 * decides anything about the sync — it turns `staff_time_entries.duration_minutes`
 * into a number the owner can read beside งาน% and เรียกเก็บ%.
 */

/** One row of the aggregate the API returns, per tasking project. */
export type ProjectHours = {
  taskingProjectId: string
  /** Sum of `duration_minutes` over finished entries. */
  minutes: number
  /** How many entries contributed, so "0 ชม." can be told from "no entries". */
  entries: number
  /**
   * Timers started and not stopped.
   *
   * Counted separately and never folded into `minutes`: a running timer has
   * `duration_minutes = 0` until it is stopped, so adding it would report work
   * in progress as no work at all. Saying "2 กำลังจับเวลา" is honest; silently
   * omitting it is not.
   */
  running: number
  /** The most recent entry date, `YYYY-MM-DD`, or null when there are none. */
  lastEntryOn: string | null
}

/**
 * Minutes as hours, to one decimal.
 *
 * Hours, not "3h 25m": the number sits beside two percentages and is read at
 * a glance for comparison, not used to fill in a timesheet.
 */
export function formatHours(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0'
  const hours = minutes / 60
  // A tenth of an hour is six minutes — fine enough for "how long has this
  // taken", and it never renders a bare 0 for a few real minutes of work.
  const rounded = Math.round(hours * 10) / 10
  return rounded < 0.1 ? '0.1' : String(rounded)
}

/** Index the aggregate by tasking project, for a client-side join. */
export function byProject(rows: ProjectHours[]): Map<string, ProjectHours> {
  return new Map(rows.map((row) => [row.taskingProjectId, row]))
}

/**
 * Hours per finished task, when both numbers exist.
 *
 * The one derived figure worth showing: it is the closest this data gets to
 * "what does a task cost us". Null when nothing is finished, because dividing
 * by zero tasks would read as an enormous cost rather than as no answer.
 */
export function hoursPerDoneTask(minutes: number, doneTasks: number): number | null {
  if (doneTasks <= 0 || minutes <= 0) return null
  return Math.round((minutes / 60 / doneTasks) * 10) / 10
}
