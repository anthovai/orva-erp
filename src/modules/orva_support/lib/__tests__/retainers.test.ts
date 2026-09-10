import { describe, expect, it } from '@jest/globals'
import { retainerAmountOf, retainersDue, retainerVerdict, type RetainerLike } from '../retainers'

const line = (over: Partial<RetainerLike> = {}): RetainerLike => ({
  id: 'r1', name: 'ดูแลระบบรายเดือน', status: 'active', invoiceOnRenewal: true,
  renewsOn: '2026-09-01', billingCycle: 'monthly',
  customerEntityId: 'c1', quoteId: 'q1', retainerAmount: 5000, cost: 0, lastInvoicedOn: null, ...over,
})

describe('which retainers are due to be billed', () => {
  it('is due once the renewal date has arrived', () => {
    expect(retainerVerdict(line(), '2026-09-01')).toEqual({ due: true, amount: 5000 })
    expect(retainerVerdict(line(), '2026-09-15')).toEqual({ due: true, amount: 5000 })
    expect(retainerVerdict(line(), '2026-08-31')).toEqual({ due: false, reason: 'not_yet' })
  })

  it('bills a cycle only once', () => {
    expect(retainerVerdict(line({ lastInvoicedOn: '2026-09-01' }), '2026-09-15')).toEqual({ due: false, reason: 'already_invoiced' })
    // Last cycle's invoice does not cover this one.
    expect(retainerVerdict(line({ lastInvoicedOn: '2026-08-01' }), '2026-09-15')).toEqual({ due: true, amount: 5000 })
  })

  it('refuses to bill without the toggle, a customer, a project, a date or an amount', () => {
    expect(retainerVerdict(line({ invoiceOnRenewal: false }), '2026-09-15').due).toBe(false)
    expect(retainerVerdict(line({ status: 'cancelled' }), '2026-09-15')).toEqual({ due: false, reason: 'cancelled' })
    expect(retainerVerdict(line({ renewsOn: null }), '2026-09-15')).toEqual({ due: false, reason: 'no_date' })
    expect(retainerVerdict(line({ customerEntityId: null }), '2026-09-15')).toEqual({ due: false, reason: 'no_customer' })
    expect(retainerVerdict(line({ quoteId: null }), '2026-09-15')).toEqual({ due: false, reason: 'no_customer' })
    expect(retainerVerdict(line({ retainerAmount: null, cost: 0 }), '2026-09-15')).toEqual({ due: false, reason: 'no_amount' })
  })

  it('falls back to the line cost when no retainer amount is set', () => {
    expect(retainerAmountOf({ retainerAmount: null, cost: 3200 })).toBe(3200)
    expect(retainerAmountOf({ retainerAmount: 1500, cost: 3200 })).toBe(1500)
    expect(retainerAmountOf({ retainerAmount: 0, cost: 3200 })).toBe(3200)
    expect(retainerAmountOf({ retainerAmount: null, cost: -5 })).toBe(0)
  })

  it('picks only the due lines out of a register', () => {
    const due = retainersDue([
      line({ id: 'a' }),
      line({ id: 'b', invoiceOnRenewal: false }),
      line({ id: 'c', renewsOn: '2026-12-01' }),
      line({ id: 'd', retainerAmount: null, cost: 900 }),
    ], '2026-09-15')
    expect(due.map((d) => [d.row.id, d.amount])).toEqual([['a', 5000], ['d', 900]])
  })
})
