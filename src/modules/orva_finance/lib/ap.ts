/**
 * Pure AP posting helpers: translate vendor-bill lines into the balanced GL
 * journal that books them (debit each expense account, credit the AP control
 * account with the bill total).
 */
export type BillLineAmount = { expenseAccountId: string; amount: number | string; description?: string | null }

export type JournalLineDraft = {
  accountId: string
  debit: string
  credit: string
  description: string | null
}

export function computeBillTotal(lines: BillLineAmount[]): string {
  let total = 0
  for (const line of lines) {
    const n = Number(line.amount)
    if (!Number.isFinite(n) || n <= 0) throw new Error('orva_ap: bill line amounts must be positive')
    total += n
  }
  return total.toFixed(4)
}

export type AllocationAmount = { billId: string; amount: number | string }

export function computeAllocationsTotal(allocations: AllocationAmount[]): string {
  let total = 0
  for (const alloc of allocations) {
    const n = Number(alloc.amount)
    if (!Number.isFinite(n) || n <= 0) throw new Error('orva_ap: allocation amounts must be positive')
    total += n
  }
  return total.toFixed(4)
}

/**
 * A payment books: debit the AP control account (reducing the liability),
 * credit the cash/bank asset account.
 */
export function buildPaymentJournalLines(total: number | string, apAccountId: string, cashAccountId: string): JournalLineDraft[] {
  const amount = Number(total)
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('orva_ap: payment total must be positive')
  if (!apAccountId) throw new Error('orva_ap: AP control account is not configured')
  if (!cashAccountId) throw new Error('orva_ap: cash account is required')
  return [
    { accountId: apAccountId, debit: amount.toFixed(4), credit: '0.0000', description: 'Accounts payable settlement' },
    { accountId: cashAccountId, debit: '0.0000', credit: amount.toFixed(4), description: 'Cash out' },
  ]
}

/** remaining = total - paid; an allocation may not exceed it. */
export function checkAllocationFits(billTotal: number | string, billPaid: number | string, amount: number | string):
  { ok: true } | { ok: false; reason: string } {
  const remaining = Number(billTotal) - Number(billPaid)
  if (Number(amount) > remaining + 0.00005) {
    return { ok: false, reason: `allocation ${Number(amount).toFixed(4)} exceeds remaining ${remaining.toFixed(4)}` }
  }
  return { ok: true }
}

export function buildBillJournalLines(lines: BillLineAmount[], apAccountId: string): JournalLineDraft[] {
  if (lines.length === 0) throw new Error('orva_ap: a bill needs at least one line')
  if (!apAccountId) throw new Error('orva_ap: AP control account is not configured')
  const total = computeBillTotal(lines)
  const drafts: JournalLineDraft[] = lines.map((line) => ({
    accountId: line.expenseAccountId,
    debit: Number(line.amount).toFixed(4),
    credit: '0.0000',
    description: line.description ?? null,
  }))
  drafts.push({ accountId: apAccountId, debit: '0.0000', credit: total, description: 'Accounts payable' })
  return drafts
}
