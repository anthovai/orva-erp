import { describe, expect, it } from '@jest/globals'
import { computeTotals, lineNet, lineVat, priceVariance, round2 } from '../totals'
import { formatPoNumber, periodKeyFor, seqAppliesTo } from '../numbering'
import { canTransition, deriveReceiptStatus, isFrozen, isSettled, remainingQty } from '../status'

describe('order totals', () => {
  it('rounds per line so the sum matches what a vendor bills', () => {
    expect(lineNet({ quantity: 3, unitPrice: 33.335, vatMode: '7' })).toBe(100.01)
    expect(lineVat({ quantity: 3, unitPrice: 33.335, vatMode: '7' })).toBe(7)
    expect(lineVat({ quantity: 3, unitPrice: 33.335, vatMode: 'none' })).toBe(0)
  })

  it('mixes taxed and untaxed lines and reports the effective rate', () => {
    const totals = computeTotals([
      { quantity: 500, unitPrice: 85, vatMode: '7' },
      { quantity: 1, unitPrice: 1500, vatMode: 'none' },
    ])
    expect(totals.subtotal).toBe(44000)
    expect(totals.taxAmount).toBe(2975)
    expect(totals.total).toBe(46975)
    // Not 7: one line carries no VAT, so printing 7% would misstate the sheet.
    expect(totals.taxRate).toBe(6.76)
  })

  it('reports 7 percent when every line is taxed', () => {
    expect(computeTotals([{ quantity: 500, unitPrice: 85, vatMode: '7' }]).taxRate).toBe(7)
  })

  it('has no tax rate when nothing is taxed', () => {
    expect(computeTotals([{ quantity: 1, unitPrice: 1500, vatMode: 'none' }]).taxRate).toBeNull()
  })

  it('rounds binary halves up rather than down', () => {
    expect(round2(1.005)).toBe(1.01)
  })

  it('shows a variance only once something is billed', () => {
    expect(priceVariance({ billedAmount: 0, orderedNet: 42500 })).toBeNull()
    expect(priceVariance({ billedAmount: 1800, orderedNet: 1500 })).toBe(300)
    expect(priceVariance({ billedAmount: 1200, orderedNet: 1500 })).toBe(-300)
  })
})

describe('PO numbering', () => {
  const date = new Date(2026, 8, 8) // 8 September 2026, local time

  it('renders the default monthly format', () => {
    expect(formatPoNumber('PO-{yyyy}{mm}-{seq:4}', { date, seq: 1 })).toBe('PO-202609-0001')
    expect(formatPoNumber('PO-{yyyy}{mm}-{seq:4}', { date, seq: 42 })).toBe('PO-202609-0042')
  })

  it('supports year-only, day and short-year formats', () => {
    expect(formatPoNumber('PO-{yy}{mm}{dd}-{seq:3}', { date, seq: 7 })).toBe('PO-260908-007')
    expect(formatPoNumber('PO-{yyyy}-{seq:5}', { date, seq: 7 })).toBe('PO-2026-00007')
  })

  it('defaults a bare sequence token to four digits', () => {
    expect(formatPoNumber('PO-{seq}', { date, seq: 5 })).toBe('PO-0005')
  })

  it('keys the counter to the period the format implies', () => {
    const monthly = 'PO-{yyyy}{mm}-{seq:4}'
    expect(periodKeyFor(monthly, date)).toBe('PO-202609-')
    // A month later the key differs, which is what restarts the run at 1.
    expect(periodKeyFor(monthly, new Date(2026, 9, 1))).toBe('PO-202610-')
    expect(seqAppliesTo({ storedPeriod: 'PO-202609-', format: monthly, date })).toBe(true)
    expect(seqAppliesTo({ storedPeriod: 'PO-202608-', format: monthly, date })).toBe(false)
    expect(seqAppliesTo({ storedPeriod: null, format: monthly, date })).toBe(false)
  })

  it('never restarts a format with no date token', () => {
    const flat = 'PO-{seq:5}'
    expect(periodKeyFor(flat, date)).toBe('PO-')
    expect(seqAppliesTo({ storedPeriod: 'PO-', format: flat, date: new Date(2030, 0, 1) })).toBe(true)
  })
})

describe('order lifecycle', () => {
  it('allows only the transitions the business has', () => {
    expect(canTransition('draft', 'sent')).toBe(true)
    expect(canTransition('draft', 'cancelled')).toBe(true)
    expect(canTransition('draft', 'received')).toBe(false)
    expect(canTransition('sent', 'cancelled')).toBe(true)
    expect(canTransition('partially_received', 'cancelled')).toBe(false)
    expect(canTransition('closed', 'sent')).toBe(false)
    expect(canTransition('cancelled', 'draft')).toBe(false)
    expect(canTransition('sent', 'nonsense')).toBe(false)
  })

  it('freezes everything but a draft', () => {
    expect(isFrozen('draft')).toBe(false)
    expect(isFrozen('sent')).toBe(true)
    expect(isSettled('closed')).toBe(true)
    expect(isSettled('sent')).toBe(false)
  })

  it('derives the received state from the receipts, not from a flag', () => {
    expect(deriveReceiptStatus([{ ordered: 500, received: 0 }])).toBe('sent')
    expect(deriveReceiptStatus([{ ordered: 500, received: 480 }])).toBe('partially_received')
    expect(deriveReceiptStatus([{ ordered: 500, received: 500 }])).toBe('received')
    // An over-delivery recorded after the quantity was raised still counts as complete.
    expect(deriveReceiptStatus([{ ordered: 500, received: 520 }])).toBe('received')
    expect(deriveReceiptStatus([
      { ordered: 500, received: 500 },
      { ordered: 1, received: 0 },
    ])).toBe('partially_received')
    expect(deriveReceiptStatus([])).toBe('sent')
  })

  it('never reports a negative remainder', () => {
    expect(remainingQty({ ordered: 500, received: 480 })).toBe(20)
    expect(remainingQty({ ordered: 500, received: 520 })).toBe(0)
  })
})
