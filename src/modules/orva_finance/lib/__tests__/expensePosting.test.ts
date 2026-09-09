import { describe, expect, it } from '@jest/globals'
import { computeExpensePosting, suggestedWithholding } from '../expensePosting'

const base = { gross: 107, kind: 'plain' as const, vatOverride: null, whtOn: false, whtRate: 3, whtAmount: null }

describe('computeExpensePosting — the preview and the payload are one arithmetic', () => {
  it('a plain shop receipt is all expense, no VAT, paid in full', () => {
    const posting = computeExpensePosting(base)
    expect(posting).toMatchObject({ net: 107, vat: 0, wht: 0, cashOut: 107, errors: [] })
    expect(posting.payload).toEqual({ amount: 107, vatMode: 'none', vatAmount: 0, whtAmount: 0, whtRate: null })
  })

  it('a full tax invoice splits the 7% out of the total the owner typed', () => {
    const posting = computeExpensePosting({ ...base, kind: 'full' })
    expect(posting).toMatchObject({ net: 100, vat: 7, cashOut: 107 })
    // inclusive mode: the route receives the gross and splits it the same way
    expect(posting.payload).toMatchObject({ amount: 107, vatMode: 'inclusive', vatAmount: 0 })
  })

  it('VAT typed from the paper switches to exclusive mode and sends the net as amount', () => {
    const posting = computeExpensePosting({ ...base, kind: 'full', vatOverride: 7.5 })
    expect(posting).toMatchObject({ net: 99.5, vat: 7.5, cashOut: 107, errors: [] })
    expect(posting.payload).toMatchObject({ amount: 99.5, vatMode: 'exclusive', vatAmount: 7.5 })
  })

  it('withholding is computed from the pre-VAT amount and reduces the cash out', () => {
    const posting = computeExpensePosting({ ...base, kind: 'full', whtOn: true, whtRate: 3 })
    expect(posting).toMatchObject({ net: 100, vat: 7, wht: 3, cashOut: 104 })
    expect(posting.payload).toMatchObject({ whtAmount: 3, whtRate: 3 })
  })

  it('a hand-edited withholding wins over the suggestion, and the rate still travels', () => {
    const posting = computeExpensePosting({ ...base, kind: 'plain', whtOn: true, whtRate: 3, whtAmount: 2.5 })
    expect(posting).toMatchObject({ wht: 2.5, cashOut: 104.5 })
    expect(posting.payload).toMatchObject({ whtAmount: 2.5, whtRate: 3 })
  })

  it('switching withholding off zeroes it whatever was typed', () => {
    const posting = computeExpensePosting({ ...base, whtOn: false, whtAmount: 50 })
    expect(posting.payload).toMatchObject({ whtAmount: 0, whtRate: null })
  })

  it('names what blocks a save: no amount, VAT not below the total, withholding not below the expense', () => {
    expect(computeExpensePosting({ ...base, gross: 0 }).errors).toEqual(['gross'])
    expect(computeExpensePosting({ ...base, kind: 'full', vatOverride: 107 }).errors).toEqual(['vat'])
    expect(computeExpensePosting({ ...base, whtOn: true, whtAmount: 107 }).errors).toEqual(['wht'])
  })

  it('suggests the withholding to two decimals', () => {
    expect(suggestedWithholding(1234.56, 3)).toBe(37.04)
  })
})
