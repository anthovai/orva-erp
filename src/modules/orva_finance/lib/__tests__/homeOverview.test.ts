import { describe, expect, test } from '@jest/globals'
import { daysBetween, monthBounds, nextMonth, previousMonth, statutoryDueDate, upcomingDeadlines } from '../homeOverview'

describe('home overview dates', () => {
  test('month arithmetic crosses the year boundary', () => {
    expect(previousMonth('2026-01')).toBe('2025-12')
    expect(nextMonth('2026-12')).toBe('2027-01')
    expect(monthBounds('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(monthBounds('2028-02').to).toBe('2028-02-29')
  })

  test('statutory deadlines: ภ.ง.ด. on the 7th, ภ.พ.30 on the 15th, weekend slides forward', () => {
    expect(statutoryDueDate('wht', '2026-08')).toBe('2026-09-07') // Monday
    expect(statutoryDueDate('vat', '2026-08')).toBe('2026-09-15') // Tuesday
    expect(statutoryDueDate('vat', '2026-10')).toBe('2026-11-16') // 15 Nov 2026 is a Sunday
  })

  test('on 3 Sep 2026 the owner sees August filings due soon and July still within grace', () => {
    const list = upcomingDeadlines('2026-09-03')
    expect(list.map((d) => `${d.kind}:${d.period}:${d.state}`)).toEqual([
      'wht:2026-07:overdue',
      'vat:2026-07:overdue',
      'wht:2026-08:due_soon',
      'vat:2026-08:upcoming',
    ])
    expect(list[2].daysLeft).toBe(4)
    expect(daysBetween('2026-09-03', '2026-09-15')).toBe(12)
  })

  test('a filing that passed more than the grace window ago drops off', () => {
    // July VAT was due 17 Aug (15th is a Saturday); 45 days later is 1 Oct.
    expect(upcomingDeadlines('2026-09-30').some((d) => d.period === '2026-07' && d.kind === 'vat')).toBe(true)
    const list = upcomingDeadlines('2026-10-05')
    expect(list.some((d) => d.period === '2026-07')).toBe(false)
    expect(list.map((d) => d.period)).toEqual(['2026-08', '2026-08', '2026-09', '2026-09'])
  })
})
