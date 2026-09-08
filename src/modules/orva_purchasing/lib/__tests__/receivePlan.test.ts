import { describe, expect, it } from '@jest/globals'
import { planReceipt, type PlannableLine } from '../receivePlan'

const goods: PlannableLine = {
  id: 'line-goods',
  lineNo: 1,
  kind: 'goods',
  description: 'Marventine Lotion 200ml',
  unit: 'ขวด',
  quantity: 500,
  unitPrice: 85,
}
const service: PlannableLine = {
  id: 'line-service',
  lineNo: 2,
  kind: 'service',
  description: 'ค่าขนส่ง',
  unit: null,
  quantity: 1,
  unitPrice: 1500,
}

const plan = (request: Parameters<typeof planReceipt>[0]['request'], received: Array<[string, number]> = []) =>
  planReceipt({ lines: [goods, service], received: new Map(received), request })

describe('planning a receipt', () => {
  it('accepts a partial delivery and reports what was outstanding', () => {
    const result = plan([{ lineId: 'line-goods', quantity: 480, lotNumber: 'MRV-2610-A' }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ quantity: 480, lotNumber: 'MRV-2610-A', remainingBefore: 500 })
    // The cost defaults to what was ordered.
    expect(result.items[0].unitCost).toBe(85)
  })

  it('measures against what has already arrived', () => {
    const ok = plan([{ lineId: 'line-goods', quantity: 20, lotNumber: 'MRV-2610-B' }], [['line-goods', 480]])
    expect(ok.ok).toBe(true)

    const over = plan([{ lineId: 'line-goods', quantity: 30, lotNumber: 'MRV-2610-B' }], [['line-goods', 480]])
    expect(over.ok).toBe(false)
    if (over.ok) return
    expect(over.failure).toEqual({
      code: 'over_receipt',
      lineNo: 1,
      description: 'Marventine Lotion 200ml',
      remaining: 20,
      unit: 'ขวด',
    })
  })

  it('refuses the whole payload when one line is over, so nothing moves', () => {
    const result = plan([
      { lineId: 'line-service', quantity: 1 },
      { lineId: 'line-goods', quantity: 501, lotNumber: 'MRV-2610-A' },
    ])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.code).toBe('over_receipt')
  })

  it('sums two rows for the same line before comparing with the remainder', () => {
    // 300 + 250 = 550 against 500 ordered: the second row is what fails, and
    // it must fail rather than each row passing on its own.
    const result = plan([
      { lineId: 'line-goods', quantity: 300, lotNumber: 'A' },
      { lineId: 'line-goods', quantity: 250, lotNumber: 'B' },
    ])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toMatchObject({ code: 'over_receipt', remaining: 200 })
  })

  it('allows two lots of the same line while they fit', () => {
    const result = plan([
      { lineId: 'line-goods', quantity: 300, lotNumber: 'A' },
      { lineId: 'line-goods', quantity: 200, lotNumber: 'B' },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items.map((item) => item.lotNumber)).toEqual(['A', 'B'])
  })

  it('demands a lot number for goods and never for a service', () => {
    const missing = plan([{ lineId: 'line-goods', quantity: 10, lotNumber: '   ' }])
    expect(missing.ok).toBe(false)
    if (missing.ok) return
    expect(missing.failure).toEqual({ code: 'lot_required', lineNo: 1 })

    const serviceOnly = plan([{ lineId: 'line-service', quantity: 1 }])
    expect(serviceOnly.ok).toBe(true)
    if (!serviceOnly.ok) return
    expect(serviceOnly.items[0].lotNumber).toBeNull()
  })

  it('rejects a line that is not on the order', () => {
    const result = plan([{ lineId: 'someone-elses-line', quantity: 1 }])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toEqual({ code: 'line_not_found', lineId: 'someone-elses-line' })
  })

  it('ignores zero-quantity rows and refuses a payload that receives nothing', () => {
    const result = plan([
      { lineId: 'line-goods', quantity: 0, lotNumber: '' },
      { lineId: 'line-service', quantity: 0 },
    ])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toEqual({ code: 'nothing_to_receive' })
  })

  it('takes an edited unit cost over the ordered price', () => {
    const result = plan([{ lineId: 'line-goods', quantity: 1, lotNumber: 'A', unitCost: 88.5 }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items[0].unitCost).toBe(88.5)
  })

  it('lets a raised quantity be received in full', () => {
    // The over-delivery path: the line was raised from 500 to 520 first, so
    // the extra 20 is now inside the order rather than outside it.
    const raised: PlannableLine = { ...goods, quantity: 520 }
    const result = planReceipt({
      lines: [raised],
      received: new Map([['line-goods', 500]]),
      request: [{ lineId: 'line-goods', quantity: 20, lotNumber: 'C' }],
    })
    expect(result.ok).toBe(true)
  })
})
