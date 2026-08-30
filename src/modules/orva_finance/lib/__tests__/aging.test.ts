import { describe, expect, test } from '@jest/globals'
import { agingBucket, buildAging, daysOverdue } from '../aging'

describe('orva_finance aging report', () => {
  test('daysOverdue and bucket edges', () => {
    expect(daysOverdue('2026-08-30', '2026-08-30')).toBe(0)
    expect(daysOverdue('2026-08-30', '2026-08-01')).toBe(29)
    expect(agingBucket(0)).toBe('current')
    expect(agingBucket(-5)).toBe('current')
    expect(agingBucket(1)).toBe('d1_30')
    expect(agingBucket(30)).toBe('d1_30')
    expect(agingBucket(31)).toBe('d31_60')
    expect(agingBucket(60)).toBe('d31_60')
    expect(agingBucket(61)).toBe('d61_90')
    expect(agingBucket(90)).toBe('d61_90')
    expect(agingBucket(91)).toBe('d90_plus')
  })

  test('buildAging buckets, totals, sorting, and zero filtering', () => {
    const report = buildAging('2026-08-30', [
      { ref: 'BILL-1', partyName: 'Acme', dueDate: '2026-09-15', remaining: 100 },   // current
      { ref: 'BILL-2', partyName: 'Acme', dueDate: '2026-08-10', remaining: 50 },    // 20d -> 1-30
      { ref: 'BILL-3', partyName: 'Beta', dueDate: '2026-05-01', remaining: 25 },    // 121d -> 90+
      { ref: 'BILL-4', partyName: 'Beta', dueDate: '2026-08-01', remaining: 0 },     // filtered
      { ref: 'BILL-5', partyName: null, dueDate: null, documentDate: '2026-07-10', remaining: 10 }, // 51d -> 31-60
    ])
    expect(report.rows.map((r) => r.ref)).toEqual(['BILL-3', 'BILL-5', 'BILL-2', 'BILL-1'])
    expect(report.totals.current).toBe('100.0000')
    expect(report.totals.d1_30).toBe('50.0000')
    expect(report.totals.d31_60).toBe('10.0000')
    expect(report.totals.d90_plus).toBe('25.0000')
    expect(report.totals.total).toBe('185.0000')
  })

  test('missing dates land in current with zero days', () => {
    const report = buildAging('2026-08-30', [{ ref: 'X', remaining: 5 }])
    expect(report.rows[0]).toMatchObject({ bucket: 'current', daysOverdue: 0, dueDate: null })
  })
})
