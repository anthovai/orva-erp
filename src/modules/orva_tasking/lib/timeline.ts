/**
 * Timeline arithmetic.
 *
 * Dates here are plain `YYYY-MM-DD` strings, not `Date` objects, and every
 * calculation goes through UTC. A task that starts on the 1st starts on the
 * 1st in Bangkok, in a test runner set to UTC, and in a browser in another
 * zone — parsing a bare date as local time is how bars end up a day out.
 */

const MS_PER_DAY = 864e5

function toUtc(iso: string): number {
  return Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10)),
  )
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function dayIndex(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / MS_PER_DAY)
}

/** The same date shifted by whole days, in either direction. */
export function addDays(iso: string, days: number): string {
  return fromUtc(toUtc(iso) + days * MS_PER_DAY)
}

export type Span = { from: string; to: string; days: number }

/**
 * The window the chart covers: earliest start to latest end, with a day of
 * padding either side so a bar never sits flush against the edge.
 *
 * `days` is always at least 1, so callers can divide by it without guarding.
 */
export function timelineSpan(tasks: { startDate: string | null; endDate: string | null }[]): Span {
  const starts = tasks.map((task) => task.startDate).filter((v): v is string => Boolean(v))
  const ends = tasks.map((task) => task.endDate).filter((v): v is string => Boolean(v))
  if (!starts.length || !ends.length) {
    const today = fromUtc(Date.now())
    return { from: today, to: today, days: 1 }
  }
  const from = addDays(starts.reduce((a, b) => (a < b ? a : b)), -1)
  const to = addDays(ends.reduce((a, b) => (a > b ? a : b)), 1)
  return { from, to, days: Math.max(1, dayIndex(from, to) + 1) }
}
