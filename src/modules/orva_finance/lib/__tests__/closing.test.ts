import { describe, expect, test } from '@jest/globals'
import { buildClosingLines } from '../closing'
import type { AccountSums } from '../statements'

const period: AccountSums[] = [
  { accountId: 'a-cash', code: '1000', name: 'Cash', accountType: 'asset', debit: 500, credit: 0 },
  { accountId: 'a-sales', code: '4000', name: 'Sales', accountType: 'income', debit: 0, credit: 500 },
  { accountId: 'a-rent', code: '5000', name: 'Rent', accountType: 'expense', debit: 200, credit: 0 },
  { accountId: 'a-zero', code: '5100', name: 'Unused', accountType: 'expense', debit: 0, credit: 0 },
]

describe('orva_finance period closing', () => {
  test('profit: income debited, expense credited, RE credited with net', () => {
    const plan = buildClosingLines(period, 'a-re')
    expect(plan.netProfit).toBe('300.0000')
    expect(plan.closedAccounts).toBe(2)
    expect(plan.lines).toEqual([
      expect.objectContaining({ accountId: 'a-sales', debit: '500.0000', credit: '0.0000' }),
      expect.objectContaining({ accountId: 'a-rent', debit: '0.0000', credit: '200.0000' }),
      expect.objectContaining({ accountId: 'a-re', debit: '0.0000', credit: '300.0000' }),
    ])
    const debit = plan.lines.reduce((sum, l) => sum + Number(l.debit), 0)
    const credit = plan.lines.reduce((sum, l) => sum + Number(l.credit), 0)
    expect(debit.toFixed(4)).toBe(credit.toFixed(4))
  })

  test('loss: retained earnings is debited', () => {
    const lossy = period.map((row) => (row.accountId === 'a-rent' ? { ...row, debit: 900 } : row))
    const plan = buildClosingLines(lossy, 'a-re')
    expect(plan.netProfit).toBe('-400.0000')
    expect(plan.lines.at(-1)).toMatchObject({ accountId: 'a-re', debit: '400.0000', credit: '0.0000' })
  })

  test('asset accounts are never closed; empty period throws', () => {
    const plan = buildClosingLines(period, 'a-re')
    expect(plan.lines.find((l) => l.accountId === 'a-cash')).toBeUndefined()
    expect(() => buildClosingLines([period[0]], 'a-re')).toThrow(/nothing to close/)
    expect(() => buildClosingLines(period, '')).toThrow(/not configured/)
  })
})
