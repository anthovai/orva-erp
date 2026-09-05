import { describe, expect, it } from '@jest/globals'
import { cleanDate, taskProgress, type TaskingTask } from '../client'

const task = (over: Partial<TaskingTask> = {}): TaskingTask => ({
  id: 1, title: 'งาน', done: false, ...over,
})

describe('cleanDate', () => {
  it('treats Vikunja’s zero time as no date', () => {
    // Go marshals an unset time.Time as year 1, which would otherwise render
    // as a due date in the year 1 and sort above everything real.
    expect(cleanDate('0001-01-01T00:00:00Z')).toBeNull()
  })

  it('keeps a real date', () => {
    expect(cleanDate('2026-09-30T00:00:00Z')).toBe('2026-09-30T00:00:00Z')
  })

  it('handles absent values', () => {
    expect(cleanDate(null)).toBeNull()
    expect(cleanDate(undefined)).toBeNull()
    expect(cleanDate('')).toBeNull()
  })
})

describe('taskProgress', () => {
  it('counts what is done', () => {
    expect(taskProgress([task({ done: true }), task({ id: 2 }), task({ id: 3, done: true })]))
      .toEqual({ total: 3, done: 2, donePct: 66.7 })
  })

  it('is 100% when everything is finished', () => {
    expect(taskProgress([task({ done: true })])).toEqual({ total: 1, done: 1, donePct: 100 })
  })

  it('does not divide by zero on an empty project', () => {
    expect(taskProgress([])).toEqual({ total: 0, done: 0, donePct: 0 })
  })

  it('reports 0% rather than nothing when no task is done yet', () => {
    expect(taskProgress([task(), task({ id: 2 })])).toEqual({ total: 2, done: 0, donePct: 0 })
  })
})
