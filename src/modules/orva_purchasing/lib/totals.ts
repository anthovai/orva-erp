/**
 * Order money, in one place, pure.
 *
 * VAT is per line because one order carries goods at 7% and, say, an
 * international freight charge at none. That means the order has no single
 * tax rate — the sheet gets the effective one, which is the honest number to
 * print when the lines disagree.
 */
export const VAT_RATE = 7

export type VatMode = 'none' | '7'

export type TotalsLine = {
  quantity: number
  unitPrice: number
  vatMode: VatMode
}

/** Two-decimal rounding that does not drift on binary halves (1.005 → 1.01). */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** Ex-VAT value of one line. */
export function lineNet(line: TotalsLine): number {
  return round2(line.quantity * line.unitPrice)
}

/** VAT on one line, rounded per line so the sum matches what a vendor bills. */
export function lineVat(line: TotalsLine): number {
  return line.vatMode === '7' ? round2((lineNet(line) * VAT_RATE) / 100) : 0
}

export type OrderTotals = {
  subtotal: number
  taxAmount: number
  total: number
  /** Effective rate for the printed sheet; null when nothing is taxed. */
  taxRate: number | null
}

export function computeTotals(lines: TotalsLine[]): OrderTotals {
  const subtotal = round2(lines.reduce((sum, line) => sum + lineNet(line), 0))
  const taxAmount = round2(lines.reduce((sum, line) => sum + lineVat(line), 0))
  return {
    subtotal,
    taxAmount,
    total: round2(subtotal + taxAmount),
    taxRate: subtotal > 0 && taxAmount > 0 ? round2((taxAmount / subtotal) * 100) : null,
  }
}

/**
 * What the bill charged for this line against what the order promised.
 * Positive means the vendor billed more than ordered — a warning, never a
 * block (spec A3, confirmed by the owner). Null until something is billed,
 * so a fresh order does not show its whole value as a variance.
 */
export function priceVariance(args: { billedAmount: number; orderedNet: number }): number | null {
  if (args.billedAmount <= 0) return null
  return round2(args.billedAmount - args.orderedNet)
}
