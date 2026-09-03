import { describe, expect, test } from '@jest/globals'
import {
  buildBillJournalLines,
  buildPaymentJournalLines,
  checkAllocationFits,
  computeAllocationsTotal,
  computeBillTotal,
} from '../ap'

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

  test('payment journal debits AP and credits cash, balanced', () => {
    const drafts = buildPaymentJournalLines(1250.5, 'acc-ap', 'acc-cash')
    expect(drafts).toEqual([
      expect.objectContaining({ accountId: 'acc-ap', debit: '1250.5000', credit: '0.0000' }),
      expect.objectContaining({ accountId: 'acc-cash', debit: '0.0000', credit: '1250.5000' }),
    ])
    expect(() => buildPaymentJournalLines(0, 'acc-ap', 'acc-cash')).toThrow(/positive/)
    expect(() => buildPaymentJournalLines(10, '', 'acc-cash')).toThrow(/not configured/)
    expect(() => buildPaymentJournalLines(10, 'acc-ap', '')).toThrow(/cash account/)
  })

  test('bill with input VAT debits the VAT account and credits AP gross', () => {
    const drafts = buildBillJournalLines([{ expenseAccountId: 'acc-exp', amount: 1000 }], 'acc-ap', 70, 'acc-vat')
    expect(drafts).toEqual([
      expect.objectContaining({ accountId: 'acc-exp', debit: '1000.0000' }),
      expect.objectContaining({ accountId: 'acc-vat', debit: '70.0000' }),
      expect.objectContaining({ accountId: 'acc-ap', credit: '1070.0000' }),
    ])
    expect(() => buildBillJournalLines([{ expenseAccountId: 'e', amount: 1 }], 'acc-ap', 7, null)).toThrow(/input VAT/)
  })

  test('payment with 3% withholding credits cash net and WHT payable', () => {
    const drafts = buildPaymentJournalLines(1070, 'acc-ap', 'acc-cash', 30, 'acc-wht')
    expect(drafts).toEqual([
      expect.objectContaining({ accountId: 'acc-ap', debit: '1070.0000' }),
      expect.objectContaining({ accountId: 'acc-cash', credit: '1040.0000' }),
      expect.objectContaining({ accountId: 'acc-wht', credit: '30.0000' }),
    ])
    expect(() => buildPaymentJournalLines(100, 'acc-ap', 'acc-cash', 3, null)).toThrow(/WHT payable/)
  })

  test('allocations total and remaining checks', () => {
    expect(computeAllocationsTotal([{ billId: 'b1', amount: 100 }, { billId: 'b2', amount: 50.25 }])).toBe('150.2500')
    expect(() => computeAllocationsTotal([{ billId: 'b1', amount: 0 }])).toThrow(/positive/)
    expect(checkAllocationFits(500, 100, 400)).toEqual({ ok: true })
    expect(checkAllocationFits(500, 100, 400.01)).toMatchObject({ ok: false })
    expect(checkAllocationFits('500.0000', '0', '500')).toEqual({ ok: true })
  })
})
