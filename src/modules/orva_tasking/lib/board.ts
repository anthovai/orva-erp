/**
 * Board ordering.
 *
 * Card positions are plain integers, renumbered from zero every time a column
 * changes. Vikunja uses a float and inserts halfway between neighbours, which
 * is cheaper per move but drifts toward unusable precision after enough drags
 * and needs a repair job. Renumbering one column is a single statement over a
 * handful of rows, and the order is always exactly what the screen showed.
 */

/**
 * The destination column's card ids, in order, after dropping `movedId` at
 * `index`.
 *
 * `current` is the column as the client last saw it. The moved card is removed
 * first, so dragging a card within its own column behaves like a reorder rather
 * than duplicating it, and `index` is clamped so a stale client cannot write a
 * gap.
 */
export function placeCard(current: string[], movedId: string, index: number): string[] {
  const without = current.filter((id) => id !== movedId)
  const at = Math.max(0, Math.min(index, without.length))
  return [...without.slice(0, at), movedId, ...without.slice(at)]
}

export type WipState = { over: boolean; count: number; limit: number }

/**
 * Whether a column is over its limit, given how many unfinished cards it holds.
 *
 * Reported, never enforced: the drop still succeeds. A tool that refuses the
 * move just moves the real work list somewhere it cannot see.
 */
export function wipState(unfinishedCount: number, limit: number): WipState {
  return { over: limit > 0 && unfinishedCount > limit, count: unfinishedCount, limit }
}
