import { describe, expect, it } from '@jest/globals'
import { lateLineGroupKey, lateLinesToNotify, shouldNotifyToday } from '../lateScan'
import type { LateLine } from '../summary'

const line = (over: Partial<LateLine> = {}): LateLine => ({
  orderId: 'order-1',
  poNumber: 'PO-202609-0001',
  lineId: 'line-1',
  lineNo: 1,
  description: 'Marventine Lotion 200ml',
  vendorName: 'บจก. โอเอ็ม คอสเมติกส์',
  unit: 'ขวด',
  orderedQty: 500,
  receivedQty: 0,
  remainingQty: 500,
  expectedOn: '2026-10-15',
  daysLate: 1,
  ...over,
})

describe('late-delivery cadence', () => {
  it('speaks on the first day, the third, then weekly', () => {
    expect(shouldNotifyToday(1)).toBe(true)
    expect(shouldNotifyToday(2)).toBe(false)
    expect(shouldNotifyToday(3)).toBe(true)
    expect(shouldNotifyToday(4)).toBe(false)
    expect(shouldNotifyToday(7)).toBe(true)
    expect(shouldNotifyToday(8)).toBe(false)
    expect(shouldNotifyToday(14)).toBe(true)
    expect(shouldNotifyToday(21)).toBe(true)
  })

  it('says nothing about something that is not late yet', () => {
    expect(shouldNotifyToday(0)).toBe(false)
    expect(shouldNotifyToday(-3)).toBe(false)
  })

  it('never produces a badge a day for a line late for a month', () => {
    // 30 days late: 1, 3, 7, 14, 21, 28 — six notifications, not thirty.
    const speaking = Array.from({ length: 30 }, (_, index) => index + 1).filter(shouldNotifyToday)
    expect(speaking).toEqual([1, 3, 7, 14, 21, 28])
  })

  it('keys one notification per line per day, so a re-run cannot nag twice', () => {
    expect(lateLineGroupKey('line-1', '2026-10-16')).toBe('orva_purchasing.line_late:line-1:2026-10-16')
    expect(lateLineGroupKey('line-1', '2026-10-16')).toBe(lateLineGroupKey('line-1', '2026-10-16'))
    expect(lateLineGroupKey('line-1', '2026-10-17')).not.toBe(lateLineGroupKey('line-1', '2026-10-16'))
  })

  it('carries what the message needs to read without a second lookup', () => {
    const [notification] = lateLinesToNotify([line({ daysLate: 3, remainingQty: 20 })], '2026-10-18')
    expect(notification.bodyVariables).toMatchObject({
      description: 'Marventine Lotion 200ml',
      vendor: 'บจก. โอเอ็ม คอสเมติกส์',
      days: '3',
      remaining: '20',
      unit: 'ขวด',
      poNumber: 'PO-202609-0001',
    })
  })

  it('filters a mixed batch down to the lines whose day it is', () => {
    const due = lateLinesToNotify(
      [
        line({ lineId: 'a', daysLate: 1 }),
        line({ lineId: 'b', daysLate: 2 }),
        line({ lineId: 'c', daysLate: 7 }),
        line({ lineId: 'd', daysLate: 9 }),
      ],
      '2026-10-20',
    )
    expect(due.map((item) => item.line.lineId)).toEqual(['a', 'c'])
  })
})
