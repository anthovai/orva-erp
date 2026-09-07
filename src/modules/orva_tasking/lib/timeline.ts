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

/**
 * The window a Gantt opens on: today minus 15 days to today plus 55.
 *
 * Vikunja's own defaults. Fifteen days back is enough to still see what
 * slipped, and eight weeks forward is about as far as anyone plans in
 * practice — wider than that and every bar becomes a sliver.
 */
export function defaultGanttRange(today: string): Span {
  const from = addDays(today, -15)
  const to = addDays(today, 55)
  return { from, to, days: dayIndex(from, to) + 1 }
}

/** Every date in the window, as `YYYY-MM-DD`, so a header can be laid out. */
export function dayList(from: string, days: number): string[] {
  return Array.from({ length: Math.max(1, days) }, (_, index) => addDays(from, index))
}

export type MonthGroup = { key: string; year: number; month: number; days: number }

/**
 * The days grouped into the months they fall in, for the upper header row.
 *
 * `days` is a count, not a width: the caller multiplies by whatever a day is
 * worth in pixels, so the same grouping works at any zoom.
 */
export function monthGroups(from: string, days: number): MonthGroup[] {
  const groups: MonthGroup[] = []
  for (const iso of dayList(from, days)) {
    const year = Number(iso.slice(0, 4))
    const month = Number(iso.slice(5, 7))
    const key = iso.slice(0, 7)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.days += 1
    else groups.push({ key, year, month, days: 1 })
  }
  return groups
}

/**
 * The window that holds a range and every dated task in it.
 *
 * The chosen range wins; a task that starts before it or ends after it still
 * has to be drawable, so the window stretches to reach. Without this a bar
 * pinned outside the range renders at a negative offset.
 */
export function ganttWindow(
  range: { from: string; to: string },
  bars: { start: string; end: string }[],
): Span {
  let from = range.from
  let to = range.to
  for (const bar of bars) {
    if (bar.start < from) from = bar.start
    if (bar.end > to) to = bar.end
  }
  return { from, to, days: Math.max(1, dayIndex(from, to) + 1) }
}
