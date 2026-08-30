/**
 * Pure financial-statement math over per-account debit/credit sums of POSTED
 * journal lines. Sign conventions:
 *   asset, expense            balance = debit - credit
 *   liability, equity, income balance = credit - debit
 *
 * With no closing entries (none exist yet in Orva), the balance sheet's
 * equity section carries a computed "current earnings" line = cumulative
 * income - expense, which is what makes Assets = Liabilities + Equity hold.
 */
export type AccountSums = {
  accountId: string
  code: string
  name: string
  accountType: string
  debit: number | string
  credit: number | string
}

export type StatementRow = {
  accountId: string
  code: string
  name: string
  balance: string
}

const CREDIT_NORMAL = new Set(['liability', 'equity', 'income'])

export function accountBalance(accountType: string, debit: number | string, credit: number | string): number {
  const d = Number(debit) || 0
  const c = Number(credit) || 0
  return CREDIT_NORMAL.has(accountType) ? c - d : d - c
}

function rowsOfType(rows: AccountSums[], type: string): { rows: StatementRow[]; total: number } {
  const out: StatementRow[] = []
  let total = 0
  for (const row of rows) {
    if (row.accountType !== type) continue
    const balance = accountBalance(row.accountType, row.debit, row.credit)
    if (Math.abs(balance) < 0.00005) continue
    total += balance
    out.push({ accountId: row.accountId, code: row.code, name: row.name, balance: balance.toFixed(4) })
  }
  out.sort((a, b) => a.code.localeCompare(b.code))
  return { rows: out, total }
}

export type ProfitAndLoss = {
  income: StatementRow[]
  expense: StatementRow[]
  totalIncome: string
  totalExpense: string
  netProfit: string
}

/** P&L over the RANGE sums (from..to). */
export function buildProfitAndLoss(rangeSums: AccountSums[]): ProfitAndLoss {
  const income = rowsOfType(rangeSums, 'income')
  const expense = rowsOfType(rangeSums, 'expense')
  return {
    income: income.rows,
    expense: expense.rows,
    totalIncome: income.total.toFixed(4),
    totalExpense: expense.total.toFixed(4),
    netProfit: (income.total - expense.total).toFixed(4),
  }
}

export type BalanceSheet = {
  asset: StatementRow[]
  liability: StatementRow[]
  equity: StatementRow[]
  currentEarnings: string
  totalAssets: string
  totalLiabilities: string
  totalEquity: string
  totalLiabilitiesAndEquity: string
  balanced: boolean
}

/** Balance sheet from CUMULATIVE sums (everything posted up to the as-of date). */
export function buildBalanceSheet(cumulativeSums: AccountSums[]): BalanceSheet {
  const asset = rowsOfType(cumulativeSums, 'asset')
  const liability = rowsOfType(cumulativeSums, 'liability')
  const equity = rowsOfType(cumulativeSums, 'equity')
  const income = rowsOfType(cumulativeSums, 'income')
  const expense = rowsOfType(cumulativeSums, 'expense')
  const currentEarnings = income.total - expense.total
  const totalEquity = equity.total + currentEarnings
  const totalLiabilitiesAndEquity = liability.total + totalEquity
  return {
    asset: asset.rows,
    liability: liability.rows,
    equity: equity.rows,
    currentEarnings: currentEarnings.toFixed(4),
    totalAssets: asset.total.toFixed(4),
    totalLiabilities: liability.total.toFixed(4),
    totalEquity: totalEquity.toFixed(4),
    totalLiabilitiesAndEquity: totalLiabilitiesAndEquity.toFixed(4),
    balanced: asset.total.toFixed(4) === totalLiabilitiesAndEquity.toFixed(4),
  }
}
