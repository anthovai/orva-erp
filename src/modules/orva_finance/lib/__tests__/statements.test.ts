import { describe, expect, test } from '@jest/globals'
import { accountBalance, buildBalanceSheet, buildProfitAndLoss, type AccountSums } from '../statements'

// A tiny complete books: owner puts in 1000 cash, sells 500 for cash,
// pays 200 expense from cash. Cash = 1300, income 500, expense 200.
const sums: AccountSums[] = [
  { accountId: 'a-cash', code: '1000', name: 'Cash', accountType: 'asset', debit: 1700, credit: 400 },
  { accountId: 'a-ap', code: '2100', name: 'AP', accountType: 'liability', debit: 200, credit: 400 },
  { accountId: 'a-cap', code: '3000', name: 'Capital', accountType: 'equity', debit: 0, credit: 1000 },
  { accountId: 'a-sales', code: '4000', name: 'Sales', accountType: 'income', debit: 0, credit: 500 },
  { accountId: 'a-rent', code: '5000', name: 'Rent', accountType: 'expense', debit: 400, credit: 0 },
  { accountId: 'a-zero', code: '5100', name: 'Unused', accountType: 'expense', debit: 0, credit: 0 },
]

describe('orva_finance financial statements', () => {
  test('sign conventions per account type', () => {
    expect(accountBalance('asset', 100, 30)).toBe(70)
    expect(accountBalance('expense', 100, 30)).toBe(70)
    expect(accountBalance('liability', 30, 100)).toBe(70)
    expect(accountBalance('equity', 30, 100)).toBe(70)
    expect(accountBalance('income', 30, 100)).toBe(70)
  })

  test('P&L totals and net profit', () => {
    const pl = buildProfitAndLoss(sums)
    expect(pl.totalIncome).toBe('500.0000')
    expect(pl.totalExpense).toBe('400.0000')
    expect(pl.netProfit).toBe('100.0000')
    expect(pl.expense.map((r) => r.code)).toEqual(['5000'])
  })

  test('zero-activity accounts are hidden', () => {
    const pl = buildProfitAndLoss(sums)
    expect(pl.expense.find((r) => r.accountId === 'a-zero')).toBeUndefined()
  })

  test('balance sheet balances via current earnings', () => {
    const bs = buildBalanceSheet(sums)
    expect(bs.totalAssets).toBe('1300.0000')
    expect(bs.totalLiabilities).toBe('200.0000')
    expect(bs.currentEarnings).toBe('100.0000')
    expect(bs.totalEquity).toBe('1100.0000')
    expect(bs.totalLiabilitiesAndEquity).toBe('1300.0000')
    expect(bs.balanced).toBe(true)
  })

  test('an unbalanced ledger is reported, not hidden', () => {
    const broken = sums.map((row) => (row.accountId === 'a-cash' ? { ...row, debit: 9999 } : row))
    expect(buildBalanceSheet(broken).balanced).toBe(false)
  })
})
