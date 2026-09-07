import { describe, expect, it } from '@jest/globals'
import {
  nextOccurrence,
  reminderMoment,
  remindersDueNow,
  type ReminderRow,
  type ReminderTask,
} from '../reminders'

const task = (over: Partial<ReminderTask> = {}): ReminderTask => ({
  id: 't1', dueOn: '2026-09-10', startDate: null, endDate: null, done: false, ...over,
})

const rel = (minutes: number, anchor: 'due' | 'start' | 'end' = 'due'): ReminderRow => ({
  id: 'r1', taskId: 't1', remindAt: null, relativeTo: anchor, relativeMinutes: minutes, lastFiredAt: null,
})

describe('reminderMoment', () => {
  it('returns an absolute moment unchanged', () => {
    const row: ReminderRow = { id: 'r', taskId: 't1', remindAt: '2026-09-01T03:00:00.000Z', relativeTo: null, relativeMinutes: null, lastFiredAt: null }
    expect(reminderMoment(row, task())?.toISOString()).toBe('2026-09-01T03:00:00.000Z')
  })

  it('reads "one day before" as the morning before, not midnight', () => {
    // 09:00 on the 9th, not 00:00 — "remind me the day before" means that
    // morning, and a midnight reminder is a reminder nobody sees.
    expect(reminderMoment(rel(24 * 60), task())?.toISOString()).toBe('2026-09-09T09:00:00.000Z')
  })

  it('handles the day itself and a negative offset (after the date)', () => {
    expect(reminderMoment(rel(0), task())?.toISOString()).toBe('2026-09-10T09:00:00.000Z')
    expect(reminderMoment(rel(-24 * 60), task())?.toISOString()).toBe('2026-09-11T09:00:00.000Z')
  })

  it('points at nothing when the anchor date is not set', () => {
    // Rather than inventing a date: a reminder relative to a start date the
    // task does not have should never fire.
    expect(reminderMoment(rel(60, 'start'), task())).toBeNull()
    expect(reminderMoment(rel(60, 'end'), task())).toBeNull()
  })

  it('uses each anchor', () => {
    const t = task({ dueOn: '2026-09-10', startDate: '2026-09-01', endDate: '2026-09-20' })
    expect(reminderMoment(rel(0, 'start'), t)?.toISOString()).toBe('2026-09-01T09:00:00.000Z')
    expect(reminderMoment(rel(0, 'end'), t)?.toISOString()).toBe('2026-09-20T09:00:00.000Z')
  })
})

describe('remindersDueNow', () => {
  const tasks = new Map([['t1', task()]])

  it('fires once the moment has passed', () => {
    const due = remindersDueNow([rel(0)], tasks, new Date('2026-09-10T09:00:00.000Z'))
    expect(due.map((r) => r.id)).toEqual(['r1'])
  })

  it('stays quiet before the moment', () => {
    expect(remindersDueNow([rel(0)], tasks, new Date('2026-09-10T08:59:00.000Z'))).toEqual([])
  })

  it('never fires twice — the property that makes a re-run safe', () => {
    const fired = { ...rel(0), lastFiredAt: '2026-09-10T09:00:00.000Z' }
    expect(remindersDueNow([fired], tasks, new Date('2026-09-11T00:00:00.000Z'))).toEqual([])
  })

  it('says nothing about a finished task', () => {
    const doneTasks = new Map([['t1', task({ done: true })]])
    expect(remindersDueNow([rel(0)], doneTasks, new Date('2026-12-01T00:00:00.000Z'))).toEqual([])
  })

  it('ignores a reminder whose task is gone', () => {
    expect(remindersDueNow([rel(0)], new Map(), new Date('2026-12-01T00:00:00.000Z'))).toEqual([])
  })
})

describe('nextOccurrence', () => {
  it('keeps the original rhythm with from_due, even when finished late', () => {
    // A weekly report stays on its day: due the 10th, ticked off the 15th,
    // next one is still the 17th.
    expect(nextOccurrence({
      id: 't', dueOn: '2026-09-10', startDate: null, endDate: null,
      repeatEveryDays: 7, repeatMode: 'from_due', doneOn: '2026-09-15',
    })).toEqual({ occurrence: '2026-09-17', dueOn: '2026-09-17', startDate: null, endDate: null })
  })

  it('measures from completion with from_completion', () => {
    // "Every 30 days after servicing": finished the 15th, next due the 15th
    // of next month, not 30 days after the date it was originally due.
    expect(nextOccurrence({
      id: 't', dueOn: '2026-09-10', startDate: null, endDate: null,
      repeatEveryDays: 30, repeatMode: 'from_completion', doneOn: '2026-09-15',
    })).toEqual({ occurrence: '2026-10-15', dueOn: '2026-10-15', startDate: null, endDate: null })
  })

  it('moves every date by the same shift, so the span is preserved', () => {
    const next = nextOccurrence({
      id: 't', dueOn: '2026-09-10', startDate: '2026-09-08', endDate: '2026-09-12',
      repeatEveryDays: 14, repeatMode: 'from_due', doneOn: '2026-09-10',
    })
    expect(next).toEqual({
      occurrence: '2026-09-24', dueOn: '2026-09-24', startDate: '2026-09-22', endDate: '2026-09-26',
    })
  })

  it('falls back to end then start when there is no due date', () => {
    expect(nextOccurrence({
      id: 't', dueOn: null, startDate: '2026-09-01', endDate: '2026-09-05',
      repeatEveryDays: 7, repeatMode: 'from_due', doneOn: '2026-09-05',
    })?.occurrence).toBe('2026-09-12')
  })

  it('makes nothing when the task does not repeat', () => {
    expect(nextOccurrence({
      id: 't', dueOn: '2026-09-10', startDate: null, endDate: null,
      repeatEveryDays: null, repeatMode: null, doneOn: '2026-09-10',
    })).toBeNull()
  })

  it('makes nothing when there is no date to move', () => {
    expect(nextOccurrence({
      id: 't', dueOn: null, startDate: null, endDate: null,
      repeatEveryDays: 7, repeatMode: 'from_due', doneOn: '2026-09-10',
    })).toBeNull()
  })

  it('refuses a non-positive interval rather than looping for ever', () => {
    for (const every of [0, -7]) {
      expect(nextOccurrence({
        id: 't', dueOn: '2026-09-10', startDate: null, endDate: null,
        repeatEveryDays: every, repeatMode: 'from_due', doneOn: '2026-09-10',
      })).toBeNull()
    }
  })

  it('always moves forward, so a repeat cannot land in the past', () => {
    const next = nextOccurrence({
      id: 't', dueOn: '2026-09-10', startDate: null, endDate: null,
      repeatEveryDays: 1, repeatMode: 'from_completion', doneOn: '2026-09-10',
    })
    expect(next!.occurrence > '2026-09-10').toBe(true)
  })
})
