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
 * A payment books:
 *   debit  AP control (liability)   total        (bills settled in full)
 *   credit cash/bank (asset)        total - wht
 *   credit WHT payable (liability)  wht          (ภ.ง.ด.3/53 — withheld from the
 *                                                 vendor, remitted to the RD next month)
 */
export function buildPaymentJournalLines(
  total: number | string,
  apAccountId: string,
  cashAccountId: string,
  wht: number | string = 0,
  whtPayableAccountId?: string | null,
): JournalLineDraft[] {
  const amount = Number(total)
  const withheld = Number(wht) || 0
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('orva_ap: payment total must be positive')
  if (!Number.isFinite(withheld) || withheld < 0) throw new Error('orva_ap: withholding must not be negative')
  if (withheld >= amount) throw new Error('orva_ap: withholding must be less than the payment total')
  if (!apAccountId) throw new Error('orva_ap: AP control account is not configured')
  if (!cashAccountId) throw new Error('orva_ap: cash account is required')
  if (withheld > 0 && !whtPayableAccountId) throw new Error('orva_ap: WHT payable account is not configured')
  const lines: JournalLineDraft[] = [
    { accountId: apAccountId, debit: amount.toFixed(4), credit: '0.0000', description: 'Accounts payable settlement' },
    { accountId: cashAccountId, debit: '0.0000', credit: (amount - withheld).toFixed(4), description: 'Cash out' },
  ]
  if (withheld > 0 && whtPayableAccountId) {
    lines.push({ accountId: whtPayableAccountId, debit: '0.0000', credit: withheld.toFixed(4), description: 'Withholding tax payable' })
  }
  return lines
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

/**
 * A bill books: debit each expense line, debit input VAT (ภาษีซื้อ) when
 * present, credit the AP control account with lines + tax.
 */
export function buildBillJournalLines(
  lines: BillLineAmount[],
  apAccountId: string,
  tax: number | string = 0,
  inputVatAccountId?: string | null,
): JournalLineDraft[] {
  if (lines.length === 0) throw new Error('orva_ap: a bill needs at least one line')
  if (!apAccountId) throw new Error('orva_ap: AP control account is not configured')
  const taxAmount = Number(tax) || 0
  if (!Number.isFinite(taxAmount) || taxAmount < 0) throw new Error('orva_ap: tax must not be negative')
  if (taxAmount > 0 && !inputVatAccountId) throw new Error('orva_ap: input VAT account is not configured')
  const net = Number(computeBillTotal(lines))
  const drafts: JournalLineDraft[] = lines.map((line) => ({
    accountId: line.expenseAccountId,
    debit: Number(line.amount).toFixed(4),
    credit: '0.0000',
    description: line.description ?? null,
  }))
  if (taxAmount > 0 && inputVatAccountId) {
    drafts.push({ accountId: inputVatAccountId, debit: taxAmount.toFixed(4), credit: '0.0000', description: 'Input VAT' })
  }
  drafts.push({ accountId: apAccountId, debit: '0.0000', credit: (net + taxAmount).toFixed(4), description: 'Accounts payable' })
  return drafts
}

/** Bill total = expense lines + input VAT. */
export function computeBillGross(lines: BillLineAmount[], tax: number | string = 0): string {
  return (Number(computeBillTotal(lines)) + (Number(tax) || 0)).toFixed(4)
}
