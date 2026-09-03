import { describe, expect, test } from '@jest/globals'
import { buildCashFlow } from '../cashflow'

const acc = (accountId: string, code: string, accountType: string, debit: number, credit: number) =>
  ({ accountId, code, name: code, accountType, debit, credit })

describe('indirect cash flow', () => {
  test('Kaiser September: invoice posted, paid net of WHT — statement ties to cash', () => {
    // opening: nothing. closing: bank 24,960 Dr; WHT recv 720 Dr; AR 0; revenue 24,000 Cr; VAT out 1,680 Cr
    const closing = [
      acc('bank', '1020', 'asset', 24960, 0),
      acc('wht', '1400', 'asset', 720, 0),
      acc('ar', '1100', 'asset', 25680, 25680),
      acc('rev', '4100', 'income', 0, 24000),
      acc('vat', '2100', 'liability', 0, 1680),
    ]
    const cf = buildCashFlow([], closing)
    expect(cf.netProfit).toBe('24000.00')
    // WHT receivable grew 720 → consumed cash; VAT payable grew 1,680 → provided cash
    expect(cf.operating).toEqual([
      { code: '1400', name: '1400', amount: '-720.00' },
      { code: '2100', name: '2100', amount: '1680.00' },
    ])
    expect(cf.totalOperating).toBe('24960.00')
    expect(cf.netChange).toBe('24960.00')
    expect(cf.closingCash).toBe('24960.00')
    expect(cf.reconciled).toBe(true)
  })

  test('fixed asset purchase is investing; depreciation is an add-back; loan is financing', () => {
    const closing = [
      acc('bank', '1020', 'asset', 100000, 36000),
      acc('fa', '1500', 'asset', 36000, 0),
      acc('ad', '1590', 'asset', 0, 600),
      acc('dep', '5400', 'expense', 600, 0),
      acc('loan', '2600', 'liability', 0, 100000),
    ]
    const cf = buildCashFlow([], closing)
    expect(cf.netProfit).toBe('-600.00')
    expect(cf.operating).toEqual([{ code: '1590', name: '1590', amount: '600.00' }])
    expect(cf.totalOperating).toBe('0.00')
    expect(cf.investing).toEqual([{ code: '1500', name: '1500', amount: '-36000.00' }])
    expect(cf.financing).toEqual([{ code: '2600', name: '2600', amount: '100000.00' }])
    expect(cf.netChange).toBe('64000.00')
    expect(cf.reconciled).toBe(true)
  })
})
