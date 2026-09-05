import { describe, expect, it } from '@jest/globals'
import { QUOTE_HORIZON_DAYS, TAX_HORIZON_DAYS, composeBrief, type BriefInput } from '../dailyBrief'

const quiet = (over: Partial<BriefInput> = {}): BriefInput => ({
  tax: [],
  ticketsAwaitingReply: 0,
  ticketsOverdue: 0,
  lapsedSubscriptions: 0,
  renewingSubscriptions: 0,
  quotes: [],
  acceptedAwaitingInstallment: 0,
  ...over,
})

describe('composeBrief', () => {
  it('says nothing on a quiet day, so the bell is not lit for nothing', () => {
    expect(composeBrief(quiet())).toBeNull()
  })

  it('counts a filing inside the horizon, and one already past it', () => {
    const brief = composeBrief(quiet({
      tax: [
        { daysLeft: TAX_HORIZON_DAYS, packSentAt: null, amount: '0.00' },
        { daysLeft: -3, packSentAt: null, amount: '1200.00' },
      ],
    }))
    expect(brief?.counts.tax).toBe(2)
  })

  it('ignores a filing still beyond the horizon', () => {
    expect(composeBrief(quiet({
      tax: [{ daysLeft: TAX_HORIZON_DAYS + 1, packSentAt: null, amount: '0.00' }],
    }))).toBeNull()
  })

  it('ignores a filing whose month pack already went to the accountant', () => {
    expect(composeBrief(quiet({
      tax: [{ daysLeft: 1, packSentAt: '2026-09-01', amount: '5000.00' }],
    }))).toBeNull()
  })

  it('still counts a nil filing — a registrant files zero returns too', () => {
    const brief = composeBrief(quiet({
      tax: [{ daysLeft: 2, packSentAt: null, amount: '0.00' }],
    }))
    expect(brief?.counts.tax).toBe(1)
  })

  it('adds unanswered and overdue tickets together', () => {
    const brief = composeBrief(quiet({ ticketsAwaitingReply: 2, ticketsOverdue: 1 }))
    expect(brief?.counts.tickets).toBe(3)
  })

  it('adds lapsed and upcoming renewals together', () => {
    const brief = composeBrief(quiet({ lapsedSubscriptions: 1, renewingSubscriptions: 2 }))
    expect(brief?.counts.renewals).toBe(3)
  })

  it('counts only quotes close to expiry, and ignores ones with no expiry', () => {
    const brief = composeBrief(quiet({
      quotes: [
        { daysLeft: 0 },
        { daysLeft: QUOTE_HORIZON_DAYS },
        { daysLeft: QUOTE_HORIZON_DAYS + 1 },
        { daysLeft: null },
      ],
    }))
    expect(brief?.counts.quotes).toBe(2)
  })

  it('counts an expired quote, which needs chasing most of all', () => {
    const brief = composeBrief(quiet({ quotes: [{ daysLeft: -4 }] }))
    expect(brief?.counts.quotes).toBe(1)
  })

  it('counts accepted work not yet billed', () => {
    const brief = composeBrief(quiet({ acceptedAwaitingInstallment: 1 }))
    expect(brief?.counts.installments).toBe(1)
  })

  it('totals every category', () => {
    const brief = composeBrief({
      tax: [{ daysLeft: 3, packSentAt: null, amount: '0.00' }],
      ticketsAwaitingReply: 2,
      ticketsOverdue: 1,
      lapsedSubscriptions: 1,
      renewingSubscriptions: 1,
      quotes: [{ daysLeft: 2 }],
      acceptedAwaitingInstallment: 1,
    })
    expect(brief?.counts).toEqual({ tax: 1, tickets: 3, renewals: 2, quotes: 1, installments: 1 })
    expect(brief?.total).toBe(8)
    // fixed reading order: money and deadlines before housekeeping
    expect(brief?.present.map((s) => s.key)).toEqual(['tax', 'installments', 'tickets', 'quotes', 'renewals'])
  })

  it('leaves overdue invoices alone — the reminder scan raises those itself', () => {
    // No input field exists for them on purpose: two notifications about the
    // same invoice on the same morning would be worse than one.
    expect(Object.keys(quiet())).not.toContain('overdueInvoices')
  })
})

describe('composeBrief present sections', () => {
  it('lists only the categories that have something', () => {
    const brief = composeBrief({
      tax: [{ daysLeft: 2, packSentAt: null, amount: '0.00' }],
      ticketsAwaitingReply: 0,
      ticketsOverdue: 0,
      lapsedSubscriptions: 0,
      renewingSubscriptions: 0,
      quotes: [],
      acceptedAwaitingInstallment: 0,
    })
    // the zeros must not reach the reader — one number, not five
    expect(brief?.present).toEqual([{ key: 'tax', count: 1 }])
  })
})
