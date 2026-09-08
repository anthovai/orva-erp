import { describe, expect, it } from '@jest/globals'
import { planBillLinks, type BillLineRow } from '../bills'

const ORDER = 'order-1'
const GOODS_LINE = 'po-line-goods'
const FREIGHT_LINE = 'po-line-freight'

const billLine = (lineNo: number, amount: number, over: Partial<BillLineRow> = {}): BillLineRow => ({
  id: `bill-line-${lineNo}`,
  billId: 'bill-1',
  billNo: 'BILL-000001',
  lineNo,
  amount,
  description: null,
  accountId: 'account-1',
  accountCode: '5300',
  linkedOrderId: null,
  ...over,
})

const plan = (args: {
  allocations: Array<{ lineId: string; billLineNo: number; amount: number }>
  lines?: BillLineRow[]
  existing?: Array<{ billLineId: string; orderLineId: string; amount: number }>
}) =>
  planBillLinks({
    orderId: ORDER,
    orderLineIds: new Set([GOODS_LINE, FREIGHT_LINE]),
    billLines: args.lines ?? [billLine(1, 42500), billLine(2, 1800)],
    existing: args.existing ?? [],
    allocations: args.allocations,
  })

const failure = (fn: () => unknown): { status?: number; code?: string; message: string } => {
  try {
    fn()
  } catch (error) {
    return {
      status: (error as { status?: number }).status,
      code: (error as { code?: string }).code,
      message: error instanceof Error ? error.message : String(error),
    }
  }
  throw new Error('expected the plan to be refused')
}

describe('planning bill links', () => {
  it('allocates each bill line to the ordered line it answers', () => {
    const result = plan({
      allocations: [
        { lineId: GOODS_LINE, billLineNo: 1, amount: 42500 },
        { lineId: FREIGHT_LINE, billLineNo: 2, amount: 1800 },
      ],
    })
    expect(result).toHaveLength(2)
    expect(result.every((item) => !item.alreadyLinked)).toBe(true)
    expect(result[1].billLine.id).toBe('bill-line-2')
  })

  it('treats an identical re-send as a no-op so a lost response can be retried', () => {
    const result = plan({
      allocations: [{ lineId: GOODS_LINE, billLineNo: 1, amount: 42500 }],
      existing: [{ billLineId: 'bill-line-1', orderLineId: GOODS_LINE, amount: 42500 }],
    })
    expect(result).toHaveLength(1)
    expect(result[0].alreadyLinked).toBe(true)
  })

  it('refuses to move a bill line that already answers a different ordered line', () => {
    const error = failure(() =>
      plan({
        allocations: [{ lineId: FREIGHT_LINE, billLineNo: 1, amount: 42500 }],
        existing: [{ billLineId: 'bill-line-1', orderLineId: GOODS_LINE, amount: 42500 }],
      }),
    )
    expect(error.status).toBe(409)
    expect(error.code).toBe('already_linked')
  })

  it('refuses to change the amount of an existing allocation', () => {
    const error = failure(() =>
      plan({
        allocations: [{ lineId: GOODS_LINE, billLineNo: 1, amount: 40000 }],
        existing: [{ billLineId: 'bill-line-1', orderLineId: GOODS_LINE, amount: 42500 }],
      }),
    )
    expect(error.code).toBe('already_linked')
  })

  it('refuses a bill line another order has taken', () => {
    const error = failure(() =>
      plan({
        allocations: [{ lineId: GOODS_LINE, billLineNo: 1, amount: 42500 }],
        lines: [billLine(1, 42500, { linkedOrderId: 'another-order' })],
      }),
    )
    expect(error.status).toBe(409)
    expect(error.code).toBe('already_linked')
  })

  it('allows more than the order promised — over-billing warns, never blocks', () => {
    // The vendor charged 1,800 freight against 1,500 ordered. Spec A3, which
    // the owner confirmed: the variance is shown, the link still happens.
    const result = plan({
      allocations: [{ lineId: FREIGHT_LINE, billLineNo: 2, amount: 1800 }],
    })
    expect(result).toHaveLength(1)
  })

  it('refuses more than the bill line itself charged', () => {
    const error = failure(() => plan({ allocations: [{ lineId: FREIGHT_LINE, billLineNo: 2, amount: 1800.01 }] }))
    expect(error.status).toBe(400)
    expect(error.code).toBe('amount_exceeds_bill_line')
  })

  it('refuses two allocations for the same bill line in one request', () => {
    const error = failure(() =>
      plan({
        allocations: [
          { lineId: GOODS_LINE, billLineNo: 1, amount: 1000 },
          { lineId: FREIGHT_LINE, billLineNo: 1, amount: 500 },
        ],
      }),
    )
    expect(error.code).toBe('duplicate_allocation')
  })

  it('refuses a line that belongs to another order, and a bill line that does not exist', () => {
    expect(failure(() => plan({ allocations: [{ lineId: 'someone-else', billLineNo: 1, amount: 1 }] })).code).toBe(
      'line_not_found',
    )
    expect(failure(() => plan({ allocations: [{ lineId: GOODS_LINE, billLineNo: 9, amount: 1 }] })).code).toBe(
      'bill_line_not_found',
    )
  })
})
