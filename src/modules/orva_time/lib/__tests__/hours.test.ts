import { describe, expect, it } from '@jest/globals'
import { byProject, formatHours, hoursPerDoneTask, type ProjectHours } from '../hours'

describe('formatHours', () => {
  it('reads as hours to one decimal', () => {
    expect(formatHours(90)).toBe('1.5')
    expect(formatHours(60)).toBe('1')
    expect(formatHours(205)).toBe('3.4')
  })

  it('says 0 for nothing logged', () => {
    expect(formatHours(0)).toBe('0')
  })

  /**
   * A few real minutes must not render as "0". Someone who logged 4 minutes
   * did log something, and a card saying 0 would read as "nobody has touched
   * this".
   */
  it('never reports real work as zero', () => {
    expect(formatHours(4)).toBe('0.1')
    expect(formatHours(1)).toBe('0.1')
  })

  it('survives nonsense rather than rendering NaN', () => {
    expect(formatHours(Number.NaN)).toBe('0')
    expect(formatHours(-30)).toBe('0')
    expect(formatHours(Number.POSITIVE_INFINITY)).toBe('0')
  })
})

describe('hoursPerDoneTask', () => {
  it('divides hours by finished tasks', () => {
    expect(hoursPerDoneTask(600, 5)).toBe(2)
    expect(hoursPerDoneTask(90, 4)).toBe(0.4)
  })

  it('has no answer rather than a wrong one when nothing is finished', () => {
    expect(hoursPerDoneTask(600, 0)).toBeNull()
    expect(hoursPerDoneTask(0, 5)).toBeNull()
  })
})

describe('byProject', () => {
  it('indexes the aggregate for a client-side join', () => {
    const rows: ProjectHours[] = [
      { taskingProjectId: 'a', minutes: 60, entries: 2, running: 0, lastEntryOn: '2026-09-07' },
      { taskingProjectId: 'b', minutes: 0, entries: 0, running: 1, lastEntryOn: null },
    ]
    const index = byProject(rows)
    expect(index.get('a')?.minutes).toBe(60)
    expect(index.get('b')?.running).toBe(1)
    expect(index.get('missing')).toBeUndefined()
  })
})
