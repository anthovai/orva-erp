import { remainingQty } from './status'

/**
 * Deciding what a delivery is allowed to record, as a pure function.
 *
 * This is the rule that matters most in receiving — nothing moves unless every
 * line is acceptable — and it was worth lifting out of the route so it can be
 * tested without a database, a warehouse or an HTTP call. The route keeps the
 * locking, the stock call and the Thai wording; the decision lives here.
 */
export type PlannableLine = {
  id: string
  lineNo: number
  kind: string
  description: string
  unit: string | null
  /** Ordered quantity. */
  quantity: number
  /** Ex-VAT ordered price, the default cost of a receipt. */
  unitPrice: number
}

export type ReceiveRequestLine = {
  lineId: string
  quantity: number
  lotNumber?: string | null
  unitCost?: number | null
}

export type ReceivePlanItem = {
  line: PlannableLine
  quantity: number
  lotNumber: string | null
  unitCost: number
  remainingBefore: number
}

export type ReceivePlanFailure =
  | { code: 'line_not_found'; lineId: string }
  | { code: 'over_receipt'; lineNo: number; description: string; remaining: number; unit: string | null }
  | { code: 'lot_required'; lineNo: number }
  | { code: 'nothing_to_receive' }

export type ReceivePlan = { ok: true; items: ReceivePlanItem[] } | { ok: false; failure: ReceivePlanFailure }

export function planReceipt(args: {
  lines: PlannableLine[]
  /** Already received per line id. */
  received: Map<string, number>
  request: ReceiveRequestLine[]
}): ReceivePlan {
  const byId = new Map(args.lines.map((line) => [line.id, line]))
  const items: ReceivePlanItem[] = []
  // Requests are summed per line first: two rows for the same line in one
  // payload must not each be measured against the full remainder.
  const requestedSoFar = new Map<string, number>()

  for (const request of args.request) {
    const line = byId.get(request.lineId)
    if (!line) return { ok: false, failure: { code: 'line_not_found', lineId: request.lineId } }
    if (request.quantity <= 0) continue

    const alreadyReceived = args.received.get(line.id) ?? 0
    const alreadyRequested = requestedSoFar.get(line.id) ?? 0
    const remaining = remainingQty({ ordered: line.quantity, received: alreadyReceived + alreadyRequested })
    if (request.quantity > remaining) {
      return {
        ok: false,
        failure: {
          code: 'over_receipt',
          lineNo: line.lineNo,
          description: line.description,
          remaining,
          unit: line.unit,
        },
      }
    }
    const lotNumber = request.lotNumber?.trim() ?? ''
    if (line.kind === 'goods' && lotNumber.length === 0) {
      return { ok: false, failure: { code: 'lot_required', lineNo: line.lineNo } }
    }

    requestedSoFar.set(line.id, alreadyRequested + request.quantity)
    items.push({
      line,
      quantity: request.quantity,
      lotNumber: line.kind === 'goods' ? lotNumber : null,
      unitCost: request.unitCost ?? line.unitPrice,
      remainingBefore: remaining,
    })
  }

  if (items.length === 0) return { ok: false, failure: { code: 'nothing_to_receive' } }
  return { ok: true, items }
}
