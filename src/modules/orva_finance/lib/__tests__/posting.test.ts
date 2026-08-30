import { describe, expect, test } from '@jest/globals'
import { checkPostable, computeTotals, toAmount } from '../posting'

describe('orva_finance posting rules', () => {
  const openPeriod = { status: 'open', startsOn: '2026-08-01', endsOn: '2026-08-31' }
  const balancedLines = [
    { debit: 100.5, credit: 0 },
    { debit: 0, credit: 100.5 },
  ]

  test('toAmount normalizes to numeric(18,4) strings', () => {
    expect(toAmount(100.5)).toBe('100.5000')
    expect(toAmount('42')).toBe('42.0000')
    expect(() => toAmount(-1)).toThrow()
    expect(() => toAmount('not-a-number')).toThrow()
  })

  test('computeTotals sums and detects balance', () => {
    expect(computeTotals(balancedLines)).toEqual({ totalDebit: '100.5000', totalCredit: '100.5000', balanced: true })
    expect(computeTotals([{ debit: 1, credit: 0 }]).balanced).toBe(false)
    expect(computeTotals([]).balanced).toBe(false)
  })

  test('a balanced draft in an open period is postable', () => {
    expect(checkPostable({ journalStatus: 'draft', journalDate: '2026-08-15', lines: balancedLines, period: openPeriod }))
      .toEqual({ ok: true })
  })

  test('posted journals cannot be posted again', () => {
    const res = checkPostable({ journalStatus: 'posted', journalDate: '2026-08-15', lines: balancedLines, period: openPeriod })
    expect(res.ok).toBe(false)
  })

  test('unbalanced journals are rejected', () => {
    const res = checkPostable({
      journalStatus: 'draft',
      journalDate: '2026-08-15',
      lines: [{ debit: 100, credit: 0 }, { debit: 0, credit: 99 }],
      period: openPeriod,
    })
    expect(res).toMatchObject({ ok: false })
  })

  test('closed periods reject posting', () => {
    const res = checkPostable({
      journalStatus: 'draft',
      journalDate: '2026-08-15',
      lines: balancedLines,
      period: { ...openPeriod, status: 'closed' },
    })
    expect(res).toMatchObject({ ok: false, reason: 'period is closed' })
  })

  test('journal date outside the period rejects posting', () => {
    const res = checkPostable({ journalStatus: 'draft', journalDate: '2026-09-01', lines: balancedLines, period: openPeriod })
    expect(res).toMatchObject({ ok: false, reason: 'journal date is outside the period' })
  })
})
