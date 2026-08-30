import type { JournalLineDraft } from './ap'

/**
 * Pure AR posting math: a sales invoice books as
 *   debit  AR control (asset)          gross total
 *   credit revenue (income)            gross - tax   (or gross when no tax account)
 *   credit tax payable (liability)     tax total     (only when configured and > 0)
 */
export function buildArJournalLines(
  grossTotal: number | string,
  taxTotal: number | string,
  arAccountId: string,
  revenueAccountId: string,
  taxAccountId?: string | null,
): JournalLineDraft[] {
  const gross = Number(grossTotal)
  const tax = Number(taxTotal) || 0
  if (!Number.isFinite(gross) || gross <= 0) throw new Error('orva_ar: invoice total must be positive')
  if (tax < 0 || tax > gross) throw new Error('orva_ar: tax total out of range')
  if (!arAccountId || !revenueAccountId) throw new Error('orva_ar: AR and revenue accounts are not configured')

  const lines: JournalLineDraft[] = [
    { accountId: arAccountId, debit: gross.toFixed(4), credit: '0.0000', description: 'Accounts receivable' },
  ]
  if (taxAccountId && tax > 0) {
    lines.push({ accountId: revenueAccountId, debit: '0.0000', credit: (gross - tax).toFixed(4), description: 'Revenue' })
    lines.push({ accountId: taxAccountId, debit: '0.0000', credit: tax.toFixed(4), description: 'Tax payable' })
  } else {
    lines.push({ accountId: revenueAccountId, debit: '0.0000', credit: gross.toFixed(4), description: 'Revenue' })
  }
  return lines
}
