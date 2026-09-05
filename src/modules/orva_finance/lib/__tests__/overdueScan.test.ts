import { describe, expect, it } from '@jest/globals'
import { REMINDER_GROUP_PREFIX, invoicesDueForReminder, type ScanInvoice } from '../overdueScan'

const TODAY = '2026-09-05'

const invoice = (over: Partial<ScanInvoice> = {}): ScanInvoice => ({
  id: 'inv-1',
  invoiceNumber: 'KK-INV-0001',
  customerName: 'บริษัท ซีซี เทค จำกัด',
  remaining: 25680,
  dueDate: '2026-08-20',
  reminderDates: [],
  ...over,
})

describe('invoicesDueForReminder', () => {
  it('picks up an overdue invoice that has never been chased', () => {
    const hits = invoicesDueForReminder([invoice()], TODAY)
    expect(hits).toHaveLength(1)
    expect(hits[0].state.neverReminded).toBe(true)
    expect(hits[0].invoiceNumber).toBe('KK-INV-0001')
  })

  it('skips an invoice that is not overdue enough yet', () => {
    expect(invoicesDueForReminder([invoice({ dueDate: '2026-09-04' })], TODAY)).toHaveLength(0)
  })

  it('skips one chased within the quiet window, and takes it again after', () => {
    expect(invoicesDueForReminder([invoice({ reminderDates: ['2026-09-03'] })], TODAY)).toHaveLength(0)
    expect(invoicesDueForReminder([invoice({ reminderDates: ['2026-08-28'] })], TODAY)).toHaveLength(1)
  })

  it('stops chasing after the maximum', () => {
    const chased = invoice({ reminderDates: ['2026-07-05', '2026-07-20', '2026-08-05'] })
    expect(invoicesDueForReminder([chased], TODAY)).toHaveLength(0)
  })

  it('ignores an invoice that has been settled', () => {
    expect(invoicesDueForReminder([invoice({ remaining: 0 })], TODAY)).toHaveLength(0)
    // half a satang of rounding is not a debt worth an email
    expect(invoicesDueForReminder([invoice({ remaining: 0.004 })], TODAY)).toHaveLength(0)
  })

  it('ignores an invoice with no due date — nothing is overdue without one', () => {
    expect(invoicesDueForReminder([invoice({ dueDate: null })], TODAY)).toHaveLength(0)
  })

  it('puts the largest amount first when several are due', () => {
    const hits = invoicesDueForReminder(
      [
        invoice({ id: 'a', invoiceNumber: 'A', remaining: 1000 }),
        invoice({ id: 'b', invoiceNumber: 'B', remaining: 90000 }),
        invoice({ id: 'c', invoiceNumber: 'C', remaining: 5000 }),
      ],
      TODAY,
    )
    expect(hits.map((h) => h.invoiceNumber)).toEqual(['B', 'C', 'A'])
  })

  it('builds a group key that is stable per invoice per day', () => {
    const [hit] = invoicesDueForReminder([invoice()], TODAY)
    expect(hit.groupKey).toBe(`${REMINDER_GROUP_PREFIX}:inv-1:${TODAY}`)
    // running the scan twice on the same day yields the same key, so the
    // notification service deduplicates rather than nagging twice
    const [again] = invoicesDueForReminder([invoice()], TODAY)
    expect(again.groupKey).toBe(hit.groupKey)
    // a different day is a different key
    const [tomorrow] = invoicesDueForReminder([invoice()], '2026-09-06')
    expect(tomorrow.groupKey).not.toBe(hit.groupKey)
  })

  it('returns nothing for an empty ledger', () => {
    expect(invoicesDueForReminder([], TODAY)).toEqual([])
  })
})
