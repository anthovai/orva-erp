/**
 * How far along a project's work is, and how that reads against its billing.
 *
 * The pairing is the point of the module: a project 80% built but 30% billed
 * means the next งวด is overdue to go out, and one 90% billed but barely
 * started means the money arrived ahead of the work. Neither is visible from
 * tasks alone or from invoices alone.
 *
 * Pure, so the arithmetic is tested without a database.
 */

export type TaskCounts = { total: number; done: number }

export function donePct(counts: TaskCounts): number {
  if (counts.total <= 0) return 0
  return Math.round((counts.done / counts.total) * 1000) / 10
}

/** How work and money compare on one project. */
export type WorkVsBilling =
  /** No tasks yet — nothing to compare, and saying "0% done" would be a lie. */
  | { verdict: 'no_tasks' }
  /** Work is ahead of billing by enough to be worth issuing the next งวด. */
  | { verdict: 'bill_behind'; gap: number }
  /** Money is ahead of the work — fine, but worth knowing. */
  | { verdict: 'work_behind'; gap: number }
  | { verdict: 'in_step'; gap: number }

/**
 * Percentage points of drift before it is worth mentioning. Below this the two
 * numbers are simply noisy against each other — งวด are lumpy by nature.
 */
export const DRIFT_THRESHOLD = 20

export function workVsBilling(counts: TaskCounts, billedPct: number): WorkVsBilling {
  if (counts.total <= 0) return { verdict: 'no_tasks' }
  const work = donePct(counts)
  const gap = Math.round((work - billedPct) * 10) / 10
  if (gap >= DRIFT_THRESHOLD) return { verdict: 'bill_behind', gap }
  if (gap <= -DRIFT_THRESHOLD) return { verdict: 'work_behind', gap: Math.abs(gap) }
  return { verdict: 'in_step', gap }
}
