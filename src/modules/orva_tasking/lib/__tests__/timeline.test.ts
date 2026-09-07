import { describe, expect, it } from '@jest/globals'
import {
  addDays,
  dayIndex,
  dayList,
  defaultGanttRange,
  ganttWindow,
  monthGroups,
  timelineSpan,
} from '../timeline'

describe('dayIndex', () => {
  it('counts whole days forwards and backwards', () => {
    expect(dayIndex('2026-09-01', '2026-09-08')).toBe(7)
    expect(dayIndex('2026-09-08', '2026-09-01')).toBe(-7)
    expect(dayIndex('2026-09-01', '2026-09-01')).toBe(0)
  })

  it('crosses a month and a year boundary', () => {
    expect(dayIndex('2026-01-31', '2026-02-01')).toBe(1)
    expect(dayIndex('2026-12-31', '2027-01-01')).toBe(1)
  })

  it('crosses a leap day', () => {
    expect(dayIndex('2028-02-28', '2028-03-01')).toBe(2)
  })

  it('is unaffected by daylight-saving shifts, because everything is UTC', () => {
    // Northern-hemisphere DST weekend. A local-time implementation returns 0 or
    // 2 here depending on the machine's zone; this must always be 1.
    expect(dayIndex('2026-03-28', '2026-03-29')).toBe(1)
    expect(dayIndex('2026-10-24', '2026-10-25')).toBe(1)
  })
})

describe('addDays', () => {
  it('moves forwards and backwards across month ends', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29')
  })

  it('returns the same date for zero', () => {
    expect(addDays('2026-09-06', 0)).toBe('2026-09-06')
  })

  it('round-trips', () => {
    expect(addDays(addDays('2026-09-06', 45), -45)).toBe('2026-09-06')
  })
})

describe('timelineSpan', () => {
  it('spans earliest start to latest end, padded a day each side', () => {
    const span = timelineSpan([
      { startDate: '2026-09-10', endDate: '2026-09-12' },
      { startDate: '2026-09-05', endDate: '2026-09-20' },
    ])
    expect(span.from).toBe('2026-09-04')
    expect(span.to).toBe('2026-09-21')
    expect(span.days).toBe(18)
  })

  it('handles a single one-day task', () => {
    const span = timelineSpan([{ startDate: '2026-09-06', endDate: '2026-09-06' }])
    expect(span).toEqual({ from: '2026-09-05', to: '2026-09-07', days: 3 })
  })

  it('never returns zero days, so callers can divide by it', () => {
    expect(timelineSpan([]).days).toBe(1)
    expect(timelineSpan([{ startDate: null, endDate: null }]).days).toBe(1)
  })

  it('ignores tasks missing either end', () => {
    const span = timelineSpan([
      { startDate: '2026-09-10', endDate: null },
      { startDate: '2026-09-01', endDate: '2026-09-02' },
    ])
    // The undated task's start is still the earliest present start value, but
    // the end can only come from a task that has one.
    expect(span.from).toBe('2026-08-31')
    expect(span.to).toBe('2026-09-03')
  })
})

describe('defaultGanttRange', () => {
  it('opens fifteen days back and fifty-five forward, like Vikunja', () => {
    expect(defaultGanttRange('2026-09-07')).toEqual({
      from: '2026-08-23', to: '2026-11-01', days: 71,
    })
  })

  it('crosses a year boundary', () => {
    expect(defaultGanttRange('2027-01-05').from).toBe('2026-12-21')
  })
})

describe('dayList', () => {
  it('lists every date in the window inclusive of both ends', () => {
    expect(dayList('2026-09-06', 3)).toEqual(['2026-09-06', '2026-09-07', '2026-09-08'])
  })

  it('never returns an empty list, so a header always has a column', () => {
    expect(dayList('2026-09-06', 0)).toEqual(['2026-09-06'])
  })
})

describe('monthGroups', () => {
  it('groups the window into months and counts the days in each', () => {
    // 30 Aug + 31 Aug, then all of September, then the 1st of October.
    expect(monthGroups('2026-08-30', 33)).toEqual([
      { key: '2026-08', year: 2026, month: 8, days: 2 },
      { key: '2026-09', year: 2026, month: 9, days: 30 },
      { key: '2026-10', year: 2026, month: 10, days: 1 },
    ])
  })

  it('separates the same month in different years', () => {
    const groups = monthGroups('2026-12-31', 2)
    expect(groups.map((g) => g.key)).toEqual(['2026-12', '2027-01'])
  })

  it('day counts always add up to the window', () => {
    const groups = monthGroups('2026-01-20', 100)
    expect(groups.reduce((sum, g) => sum + g.days, 0)).toBe(100)
  })
})

describe('ganttWindow', () => {
  it('keeps the chosen range when every bar fits inside it', () => {
    expect(ganttWindow(
      { from: '2026-09-01', to: '2026-09-30' },
      [{ start: '2026-09-05', end: '2026-09-10' }],
    )).toEqual({ from: '2026-09-01', to: '2026-09-30', days: 30 })
  })

  it('stretches to reach a bar that starts before or ends after the range', () => {
    expect(ganttWindow(
      { from: '2026-09-01', to: '2026-09-30' },
      [{ start: '2026-08-25', end: '2026-10-04' }],
    )).toEqual({ from: '2026-08-25', to: '2026-10-04', days: 41 })
  })

  it('survives an empty chart', () => {
    expect(ganttWindow({ from: '2026-09-01', to: '2026-09-01' }, []).days).toBe(1)
  })
})
