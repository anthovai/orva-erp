import { describe, expect, it } from '@jest/globals'
import { daysBetween, reminderLabel, reminderState } from '../reminders'

const TODAY = '2026-09-05'

describe('daysBetween', () => {
  it('counts forward, backward and across a month end', () => {
    expect(daysBetween('2026-09-01', '2026-09-05')).toBe(4)
    expect(daysBetween('2026-09-05', '2026-09-05')).toBe(0)
    expect(daysBetween('2026-09-10', '2026-09-05')).toBe(-5)
    expect(daysBetween('2026-08-31', '2026-09-01')).toBe(1)
  })
})

describe('reminderState', () => {
  it('stays quiet before the invoice is overdue enough', () => {
    // due 2 days ago — under the 3-day threshold
    const state = reminderState({ dueDate: '2026-09-03' }, TODAY)
    expect(state.daysOverdue).toBe(2)
    expect(state.dueForReminder).toBe(false)
    expect(state.neverReminded).toBe(false)
  })

  it('flags an overdue invoice never chased', () => {
    const state = reminderState({ dueDate: '2026-09-02' }, TODAY)
    expect(state).toMatchObject({
      daysOverdue: 3,
      remindersSent: 0,
      daysSinceReminder: null,
      dueForReminder: true,
      neverReminded: true,
      exhausted: false,
    })
  })

  it('goes quiet for the interval after a reminder, then asks again', () => {
    const justSent = reminderState({ dueDate: '2026-08-20', reminderDates: ['2026-09-04'] }, TODAY)
    expect(justSent.dueForReminder).toBe(false)
    expect(justSent.daysSinceReminder).toBe(1)
    expect(justSent.neverReminded).toBe(false)

    const gone7Days = reminderState({ dueDate: '2026-08-20', reminderDates: ['2026-08-29'] }, TODAY)
    expect(gone7Days.daysSinceReminder).toBe(7)
    expect(gone7Days.dueForReminder).toBe(true)
  })

  it('does not fire on the day a reminder was sent', () => {
    const state = reminderState({ dueDate: '2026-08-01', reminderDates: [TODAY] }, TODAY)
    expect(state.daysSinceReminder).toBe(0)
    expect(state.dueForReminder).toBe(false)
  })

  it('stops after the maximum and reports it as exhausted', () => {
    const state = reminderState(
      { dueDate: '2026-07-01', reminderDates: ['2026-07-05', '2026-07-15', '2026-07-25'] },
      TODAY,
    )
    expect(state.remindersSent).toBe(3)
    expect(state.dueForReminder).toBe(false)
    expect(state.exhausted).toBe(true)
  })

  it('reads the latest reminder whatever order history arrives in', () => {
    const state = reminderState(
      { dueDate: '2026-08-01', reminderDates: ['2026-08-10', '2026-09-04', '2026-08-20'] },
      TODAY,
    )
    expect(state.daysSinceReminder).toBe(1)
  })

  it('treats an invoice with no due date as not overdue', () => {
    const state = reminderState({ dueDate: null, reminderDates: ['2026-08-01'] }, TODAY)
    expect(state.daysOverdue).toBe(0)
    expect(state.dueForReminder).toBe(false)
    expect(state.exhausted).toBe(false)
  })
})

describe('reminderLabel', () => {
  it('says nothing for an invoice that is not overdue', () => {
    expect(reminderLabel(reminderState({ dueDate: '2026-09-30' }, TODAY))).toBeNull()
  })

  it('calls out the never-chased case', () => {
    expect(reminderLabel(reminderState({ dueDate: '2026-09-01' }, TODAY))).toEqual({ key: 'never' })
  })

  it('reports how long since the last nudge once one is due again', () => {
    expect(reminderLabel(reminderState({ dueDate: '2026-08-01', reminderDates: ['2026-08-25'] }, TODAY)))
      .toEqual({ key: 'due', days: 11 })
  })

  it('otherwise reports how many went out', () => {
    expect(reminderLabel(reminderState({ dueDate: '2026-08-01', reminderDates: ['2026-09-04'] }, TODAY)))
      .toEqual({ key: 'sent', days: 1 })
  })
})
