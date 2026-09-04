import { describe, expect, it } from '@jest/globals'
import { projectProgress } from '../projects'

describe('projectProgress', () => {
  it('reads a fresh quote with no invoices as not started', () => {
    const p = projectProgress({ quoteTotal: 107000, billed: 0, paid: 0 })
    expect(p.status).toBe('not_started')
    expect(p.billedPct).toBe(0)
    expect(p.remainingToBill).toBe(107000)
    expect(p.remainingToCollect).toBe(0)
  })

  it('tracks a project mid-way through its งวด', () => {
    // 3 งวด of 35,666.67 on a 107,000 quote; first paid, second issued
    const p = projectProgress({ quoteTotal: 107000, billed: 71333.34, paid: 35666.67 })
    expect(p.status).toBe('billing')
    expect(p.billedPct).toBeCloseTo(66.7, 1)
    expect(p.paidPct).toBeCloseTo(33.3, 1)
    expect(p.remainingToBill).toBeCloseTo(35666.66, 2)
    expect(p.remainingToCollect).toBeCloseTo(35666.67, 2)
  })

  it('is fully billed but not complete while money is outstanding', () => {
    const p = projectProgress({ quoteTotal: 107000, billed: 107000, paid: 71333.34 })
    expect(p.status).toBe('billed')
    expect(p.billedPct).toBe(100)
    expect(p.remainingToBill).toBe(0)
    expect(p.remainingToCollect).toBeCloseTo(35666.66, 2)
  })

  it('completes when payments cover the quote, tolerating satang rounding', () => {
    // last งวด rounded down by half a satang must still read complete
    const p = projectProgress({ quoteTotal: 107000, billed: 107000, paid: 106999.996 })
    expect(p.status).toBe('complete')
    expect(p.paidPct).toBe(100)
  })

  it('caps percentages at 100 when a debit note pushes billing over the quote', () => {
    const p = projectProgress({ quoteTotal: 100000, billed: 105000, paid: 0 })
    expect(p.billedPct).toBe(100)
    expect(p.status).toBe('billed')
    expect(p.remainingToBill).toBe(0)
    expect(p.remainingToCollect).toBe(105000)
  })

  it('does not divide by zero on a zero-value quote', () => {
    const p = projectProgress({ quoteTotal: 0, billed: 0, paid: 0 })
    expect(p.status).toBe('not_started')
    expect(p.billedPct).toBe(0)
    expect(p.paidPct).toBe(0)
  })
})
