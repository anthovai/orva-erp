/**
 * The order lifecycle, pure.
 *
 * `partially_received` and `received` are derived: nothing sets them by hand,
 * every receipt write recomputes them from the receipt sums. `closed` is the
 * only manual exit — it is how a permanently short delivery stops being
 * chased, recording what never arrived instead of pretending the order was
 * smaller than it was.
 */
export const PO_STATUSES = ['draft', 'sent', 'partially_received', 'received', 'closed', 'cancelled'] as const
export type PoStatus = (typeof PO_STATUSES)[number]

const ALLOWED: Record<PoStatus, readonly PoStatus[]> = {
  draft: ['sent', 'cancelled'],
  sent: ['partially_received', 'received', 'closed', 'cancelled'],
  partially_received: ['received', 'closed'],
  received: ['partially_received', 'closed'],
  closed: [],
  cancelled: [],
}

export function isPoStatus(value: string): value is PoStatus {
  return (PO_STATUSES as readonly string[]).includes(value)
}

export function canTransition(from: string, to: string): boolean {
  if (!isPoStatus(from) || !isPoStatus(to)) return false
  return ALLOWED[from].includes(to)
}

/** Everything but a draft is frozen: prices, accounts and line membership. */
export function isFrozen(status: string): boolean {
  return status !== 'draft'
}

/** A closed or cancelled order takes no more goods and no more bills. */
export function isSettled(status: string): boolean {
  return status === 'closed' || status === 'cancelled'
}

/** Only a sent order can be received against or billed. */
export function acceptsGoods(status: string): boolean {
  return status === 'sent' || status === 'partially_received' || status === 'received'
}

export type ReceiptProgress = { ordered: number; received: number }

/**
 * The status the receipts imply. Called after every receipt write, so a
 * correction that removes quantity walks the order back down.
 */
export function deriveReceiptStatus(lines: ReceiptProgress[]): 'sent' | 'partially_received' | 'received' {
  if (lines.length === 0) return 'sent'
  const complete = lines.every((line) => line.received >= line.ordered)
  if (complete) return 'received'
  return lines.some((line) => line.received > 0) ? 'partially_received' : 'sent'
}

/** How much of a line may still arrive. Never negative. */
export function remainingQty(line: ReceiptProgress): number {
  return Math.max(0, line.ordered - line.received)
}
