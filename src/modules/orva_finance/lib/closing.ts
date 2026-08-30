import type { JournalLineDraft } from './ap'
import { accountBalance, type AccountSums } from './statements'

export type ClosingPlan = {
  lines: JournalLineDraft[]
  netProfit: string
  closedAccounts: number
}

/**
 * Pure closing-entry math: zero every income and expense account of the
 * period into retained earnings.
 *   income  (credit-normal, balance > 0)  -> DEBIT the income account
 *   expense (debit-normal, balance > 0)   -> CREDIT the expense account
 *   net profit -> CREDIT retained earnings; net loss -> DEBIT it.
 * Balanced by construction. Throws when the period has nothing to close.
 */
export function buildClosingLines(periodSums: AccountSums[], retainedEarningsAccountId: string): ClosingPlan {
  if (!retainedEarningsAccountId) throw new Error('orva_gl: retained earnings account is not configured')
  const lines: JournalLineDraft[] = []
  let net = 0
  for (const row of periodSums) {
    if (row.accountType !== 'income' && row.accountType !== 'expense') continue
    const balance = accountBalance(row.accountType, row.debit, row.credit)
    if (Math.abs(balance) < 0.00005) continue
    if (row.accountType === 'income') {
      // Positive income balance sits on the credit side; debit to zero it.
      lines.push({
        accountId: row.accountId,
        debit: balance > 0 ? balance.toFixed(4) : '0.0000',
        credit: balance > 0 ? '0.0000' : (-balance).toFixed(4),
        description: `Close ${row.code} ${row.name}`,
      })
      net += balance
    } else {
      lines.push({
        accountId: row.accountId,
        debit: balance > 0 ? '0.0000' : (-balance).toFixed(4),
        credit: balance > 0 ? balance.toFixed(4) : '0.0000',
        description: `Close ${row.code} ${row.name}`,
      })
      net -= balance
    }
  }
  if (lines.length === 0) throw new Error('orva_gl: nothing to close in this period')
  lines.push({
    accountId: retainedEarningsAccountId,
    debit: net < 0 ? (-net).toFixed(4) : '0.0000',
    credit: net > 0 ? net.toFixed(4) : '0.0000',
    description: 'Retained earnings',
  })
  return { lines, netProfit: net.toFixed(4), closedAccounts: lines.length - 1 }
}
