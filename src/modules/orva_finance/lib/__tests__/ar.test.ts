import { describe, expect, test } from '@jest/globals'
import { buildArJournalLines, buildReceiptJournalLines } from '../ar'

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

  test('receipt journal debits cash and credits AR, balanced', () => {
    const lines = buildReceiptJournalLines(250.5, 'acc-cash', 'acc-ar')
    expect(lines).toEqual([
      expect.objectContaining({ accountId: 'acc-cash', debit: '250.5000', credit: '0.0000' }),
      expect.objectContaining({ accountId: 'acc-ar', debit: '0.0000', credit: '250.5000' }),
    ])
    expect(() => buildReceiptJournalLines(0, 'c', 'a')).toThrow(/positive/)
    expect(() => buildReceiptJournalLines(10, '', 'a')).toThrow(/cash account/)
    expect(() => buildReceiptJournalLines(10, 'c', '')).toThrow(/not configured/)
  })

  test('receipt with 3% withholding: cash net, WHT receivable, AR gross — balanced', () => {
    // KK-INV-2026012: 25,680 gross, customer withheld 720 (3% of 24,000 net), transferred 24,960
    const lines = buildReceiptJournalLines(25680, 'acc-bank', 'acc-ar', 720, 'acc-wht')
    expect(lines).toEqual([
      expect.objectContaining({ accountId: 'acc-bank', debit: '24960.0000' }),
      expect.objectContaining({ accountId: 'acc-wht', debit: '720.0000' }),
      expect.objectContaining({ accountId: 'acc-ar', credit: '25680.0000' }),
    ])
    const debit = lines.reduce((sum, l) => sum + Number(l.debit), 0)
    const credit = lines.reduce((sum, l) => sum + Number(l.credit), 0)
    expect(debit.toFixed(4)).toBe(credit.toFixed(4))
    expect(() => buildReceiptJournalLines(100, 'c', 'a', 3, null)).toThrow(/WHT receivable/)
    expect(() => buildReceiptJournalLines(100, 'c', 'a', 100, 'w')).toThrow(/less than/)
  })
})
