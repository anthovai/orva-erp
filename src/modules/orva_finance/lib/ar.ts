import type { JournalLineDraft } from './ap'

/**
 * A customer receipt books:
 *   debit  cash/bank (asset)        total - wht
 *   debit  WHT receivable (asset)   wht     (ภาษีถูกหัก ณ ที่จ่าย — the customer
 *                                            remits it to the RD on our behalf)
 *   credit AR control (asset)       total   (the invoice is settled in full)
 * Without withholding this is the classic two-line receipt.
 */
export function buildReceiptJournalLines(
  total: number | string,
  cashAccountId: string,
  arAccountId: string,
  wht: number | string = 0,
  whtReceivableAccountId?: string | null,
): JournalLineDraft[] {
  const amount = Number(total)
  const withheld = Number(wht) || 0
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('orva_ar: receipt total must be positive')
  if (!Number.isFinite(withheld) || withheld < 0) throw new Error('orva_ar: withholding must not be negative')
  if (withheld >= amount) throw new Error('orva_ar: withholding must be less than the receipt total')
  if (!cashAccountId) throw new Error('orva_ar: cash account is required')
  if (!arAccountId) throw new Error('orva_ar: AR control account is not configured')
  if (withheld > 0 && !whtReceivableAccountId) throw new Error('orva_ar: WHT receivable account is not configured')
  const lines: JournalLineDraft[] = [
    { accountId: cashAccountId, debit: (amount - withheld).toFixed(4), credit: '0.0000', description: 'Cash in' },
  ]
  if (withheld > 0 && whtReceivableAccountId) {
    lines.push({ accountId: whtReceivableAccountId, debit: withheld.toFixed(4), credit: '0.0000', description: 'Withholding tax receivable' })
  }
  lines.push({ accountId: arAccountId, debit: '0.0000', credit: amount.toFixed(4), description: 'Accounts receivable settlement' })
  return lines
}

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
