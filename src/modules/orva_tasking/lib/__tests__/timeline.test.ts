import { describe, expect, it } from '@jest/globals'
import { addDays, dayIndex, timelineSpan } from '../timeline'

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
