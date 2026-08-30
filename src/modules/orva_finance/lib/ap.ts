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
