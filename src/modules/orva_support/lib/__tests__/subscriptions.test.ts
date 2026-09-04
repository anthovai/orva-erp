import { describe, expect, it } from '@jest/globals'
import { addMonths, annualisedCost, daysUntil, nextRenewal, renewalState, summarise } from '../subscriptions'

describe('addMonths', () => {
  it('adds whole months', () => {
    expect(addMonths('2026-09-04', 1)).toBe('2026-10-04')
    expect(addMonths('2026-09-04', 12)).toBe('2027-09-04')
  })

  it('clamps to the end of a shorter month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30')
  })
})

describe('daysUntil', () => {
  it('counts forward and backward', () => {
    expect(daysUntil('2026-09-10', '2026-09-04')).toBe(6)
    expect(daysUntil('2026-09-04', '2026-09-04')).toBe(0)
    expect(daysUntil('2026-08-30', '2026-09-04')).toBe(-5)
  })
})

describe('renewalState', () => {
  const today = '2026-09-04'

  it('flags a passed date as lapsed', () => {
    expect(renewalState('2026-09-03', today)).toBe('lapsed')
  })

  it('flags today and the lead window as due soon', () => {
    expect(renewalState('2026-09-04', today)).toBe('due_soon')
    expect(renewalState('2026-10-04', today)).toBe('due_soon')
  })

  it('leaves anything past the lead window upcoming', () => {
    expect(renewalState('2026-10-05', today)).toBe('upcoming')
  })
})

describe('nextRenewal', () => {
  it('steps one cycle on for a current line', () => {
    expect(nextRenewal('2026-10-01', 'monthly', '2026-09-04')).toBe('2026-11-01')
    expect(nextRenewal('2026-10-01', 'quarterly', '2026-09-04')).toBe('2027-01-01')
    expect(nextRenewal('2026-10-01', 'yearly', '2026-09-04')).toBe('2027-10-01')
  })

  it('rolls a long-lapsed monthly line forward past today', () => {
    // three months overdue: one hop is still in the past, so it keeps going
    expect(nextRenewal('2026-06-01', 'monthly', '2026-09-04')).toBe('2026-10-01')
  })

  it('has no next date for a one-off purchase', () => {
    expect(nextRenewal('2026-10-01', 'one_time', '2026-09-04')).toBeNull()
  })
})

describe('annualisedCost', () => {
  it('scales each cycle to a year', () => {
    expect(annualisedCost(500, 'monthly')).toBe(6000)
    expect(annualisedCost(1500, 'quarterly')).toBe(6000)
    expect(annualisedCost(6000, 'yearly')).toBe(6000)
  })

  it('leaves a one-off purchase out of the run-rate', () => {
    expect(annualisedCost(6000, 'one_time')).toBe(0)
  })
})

describe('summarise', () => {
  const today = '2026-09-04'

  it('counts lapsed and due-soon lines and totals the run-rate', () => {
    const result = summarise([
      { renewsOn: '2026-08-20', cycle: 'yearly', cost: 12000, status: 'active' },
      { renewsOn: '2026-09-20', cycle: 'monthly', cost: 300, status: 'active' },
      { renewsOn: '2027-06-01', cycle: 'yearly', cost: 5000, status: 'active' },
    ], today)
    expect(result).toEqual({ lapsed: 1, dueSoon: 1, annualTotal: 20600 })
  })

  it('ignores cancelled lines entirely', () => {
    expect(summarise([
      { renewsOn: '2026-08-01', cycle: 'yearly', cost: 9000, status: 'cancelled' },
    ], today)).toEqual({ lapsed: 0, dueSoon: 0, annualTotal: 0 })
  })

  it('keeps a line with no renewal date in the run-rate but out of the counts', () => {
    expect(summarise([
      { renewsOn: null, cycle: 'monthly', cost: 100, status: 'active' },
    ], today)).toEqual({ lapsed: 0, dueSoon: 0, annualTotal: 1200 })
  })
})
