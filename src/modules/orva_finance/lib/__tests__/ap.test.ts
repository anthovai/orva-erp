import { describe, expect, test } from '@jest/globals'
import { buildBillJournalLines, computeBillTotal } from '../ap'

describe('orva_finance AP posting helpers', () => {
  const lines = [
    { expenseAccountId: 'acc-rent', amount: 1000, description: 'Office rent' },
    { expenseAccountId: 'acc-util', amount: 250.5, description: null },
  ]

  test('computeBillTotal sums positive lines', () => {
    expect(computeBillTotal(lines)).toBe('1250.5000')
    expect(() => computeBillTotal([{ expenseAccountId: 'a', amount: 0 }])).toThrow()
    expect(() => computeBillTotal([{ expenseAccountId: 'a', amount: -5 }])).toThrow()
  })

  test('buildBillJournalLines debits expenses and credits AP with the total', () => {
    const drafts = buildBillJournalLines(lines, 'acc-ap')
    expect(drafts).toHaveLength(3)
    expect(drafts[0]).toMatchObject({ accountId: 'acc-rent', debit: '1000.0000', credit: '0.0000' })
    expect(drafts[1]).toMatchObject({ accountId: 'acc-util', debit: '250.5000', credit: '0.0000' })
    expect(drafts[2]).toMatchObject({ accountId: 'acc-ap', debit: '0.0000', credit: '1250.5000' })
    const debit = drafts.reduce((sum, d) => sum + Number(d.debit), 0)
    const credit = drafts.reduce((sum, d) => sum + Number(d.credit), 0)
    expect(debit.toFixed(4)).toBe(credit.toFixed(4))
  })

  test('requires an AP account and at least one line', () => {
    expect(() => buildBillJournalLines(lines, '')).toThrow(/not configured/)
    expect(() => buildBillJournalLines([], 'acc-ap')).toThrow(/at least one line/)
  })
})
