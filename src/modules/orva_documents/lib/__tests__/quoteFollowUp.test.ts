import { describe, expect, it } from '@jest/globals'
import { daysBetween, quoteFollowUp } from '../quoteFollowUp'

const TODAY = '2026-09-11'
const ask = (over: Partial<Parameters<typeof quoteFollowUp>[0]> = {}) =>
  quoteFollowUp({ createdOn: '2026-09-01', validUntil: null, sentDates: [], today: TODAY, ...over })

describe('counting days', () => {
  it('counts whole days forward and backward, and survives a month boundary', () => {
    expect(daysBetween('2026-09-01', '2026-09-11')).toBe(10)
    expect(daysBetween('2026-09-11', '2026-09-01')).toBe(-10)
    expect(daysBetween('2026-08-30', '2026-09-02')).toBe(3)
    expect(daysBetween('2026-09-11', '2026-09-11')).toBe(0)
  })

  it('answers 0 rather than NaN for a date it cannot read', () => {
    expect(daysBetween('not-a-date', TODAY)).toBe(0)
  })
})

describe('a quote nobody has sent', () => {
  it('is not late on the day it is written', () => {
    const f = ask({ createdOn: TODAY })
    expect(f.state).toBe('waiting')
    expect(f.actionable).toBe(false)
    expect(f.lastSentOn).toBeNull()
    expect(f.sendCount).toBe(0)
  })

  it('becomes work once it has sat unsent', () => {
    const f = ask({ createdOn: '2026-09-08' })
    expect(f.state).toBe('never_sent')
    expect(f.actionable).toBe(true)
    expect(f.daysSinceSent).toBeNull()
  })
})

describe('a quote that went out', () => {
  it('is left alone while the customer is still thinking', () => {
    const f = ask({ sentDates: ['2026-09-08'] })
    expect(f.state).toBe('waiting')
    expect(f.daysSinceSent).toBe(3)
    expect(f.actionable).toBe(false)
  })

  it('is worth chasing after a week of silence', () => {
    const f = ask({ sentDates: ['2026-09-04'] })
    expect(f.state).toBe('due')
    expect(f.daysSinceSent).toBe(7)
    expect(f.actionable).toBe(true)
  })

  it('counts every chase and measures from the most recent one', () => {
    const f = ask({ sentDates: ['2026-08-20', '2026-09-10', '2026-09-01'] })
    expect(f.sendCount).toBe(3)
    expect(f.lastSentOn).toBe('2026-09-10')
    expect(f.daysSinceSent).toBe(1)
    expect(f.state).toBe('waiting')
  })
})

describe('the validity date outranks the cadence', () => {
  it('a quote about to expire is urgent even when it went out yesterday', () => {
    const f = ask({ sentDates: ['2026-09-10'], validUntil: '2026-09-13' })
    expect(f.state).toBe('expiring')
    expect(f.daysToExpiry).toBe(2)
    expect(f.actionable).toBe(true)
  })

  it('a quote past its date says so, however recently it was chased', () => {
    const f = ask({ sentDates: ['2026-09-10'], validUntil: '2026-09-09' })
    expect(f.state).toBe('expired')
    expect(f.daysToExpiry).toBe(-2)
    expect(f.actionable).toBe(true)
  })

  it('a distant validity date does not disturb the normal cadence', () => {
    expect(ask({ sentDates: ['2026-09-10'], validUntil: '2026-12-31' }).state).toBe('waiting')
    expect(ask({ sentDates: ['2026-09-01'], validUntil: '2026-12-31' }).state).toBe('due')
  })

  it('a quote with no validity date is judged on the cadence alone', () => {
    expect(ask({ sentDates: ['2026-09-01'] }).daysToExpiry).toBeNull()
    expect(ask({ sentDates: ['2026-09-01'] }).state).toBe('due')
  })
})
