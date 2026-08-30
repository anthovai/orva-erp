import { describe, expect, test } from '@jest/globals'
import { buildArJournalLines } from '../ar'

describe('orva_finance AR posting helpers', () => {
  test('without tax account: debit AR gross, credit revenue gross', () => {
    const lines = buildArJournalLines(107, 7, 'acc-ar', 'acc-rev', null)
    expect(lines).toEqual([
      expect.objectContaining({ accountId: 'acc-ar', debit: '107.0000', credit: '0.0000' }),
      expect.objectContaining({ accountId: 'acc-rev', debit: '0.0000', credit: '107.0000' }),
    ])
  })

  test('with tax account: revenue net of tax, tax to payable, balanced', () => {
    const lines = buildArJournalLines(107, 7, 'acc-ar', 'acc-rev', 'acc-tax')
    expect(lines).toEqual([
      expect.objectContaining({ accountId: 'acc-ar', debit: '107.0000' }),
      expect.objectContaining({ accountId: 'acc-rev', credit: '100.0000' }),
      expect.objectContaining({ accountId: 'acc-tax', credit: '7.0000' }),
    ])
    const debit = lines.reduce((sum, l) => sum + Number(l.debit), 0)
    const credit = lines.reduce((sum, l) => sum + Number(l.credit), 0)
    expect(debit.toFixed(4)).toBe(credit.toFixed(4))
  })

  test('guards', () => {
    expect(() => buildArJournalLines(0, 0, 'a', 'r')).toThrow(/positive/)
    expect(() => buildArJournalLines(100, 200, 'a', 'r')).toThrow(/out of range/)
    expect(() => buildArJournalLines(100, 0, '', 'r')).toThrow(/not configured/)
  })
})
