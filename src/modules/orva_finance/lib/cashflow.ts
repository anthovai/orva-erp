import { accountBalance, type AccountSums } from './statements'

/**
 * Indirect-method cash flow (งบกระแสเงินสด) from two cumulative trial
 * balances (opening = before `from`, closing = through `to`).
 *
 * Classification follows the Thai SME chart this module seeds:
 *   1000–1099  cash & bank            → the thing being explained
 *   15xx       fixed assets           → investing (accumulated depreciation
 *                                       1590 is a non-cash add-back instead)
 *   26xx, 3xxx loans & equity         → financing
 *   everything else on the balance sheet → operating working capital
 *   income/expense                    → net profit (operating)
 * Sign convention: an asset increase uses cash (negative), a liability or
 * equity increase provides cash (positive).
 */
export type CashFlowLine = { code: string; name: string; amount: string }

export type CashFlowStatement = {
  netProfit: string
  operating: CashFlowLine[]
  investing: CashFlowLine[]
  financing: CashFlowLine[]
  totalOperating: string
  totalInvesting: string
  totalFinancing: string
  netChange: string
  openingCash: string
  closingCash: string
  /** netChange equals closing − opening cash — the statement ties out */
  reconciled: boolean
}

const isCash = (code: string) => /^10\d\d/.test(code)
const isFixedAsset = (code: string) => /^15\d\d/.test(code) && !isAccumDepr(code)
const isAccumDepr = (code: string) => /^159\d/.test(code)
const isFinancing = (code: string) => /^26\d\d/.test(code) || /^3\d\d\d/.test(code)

const fix = (n: number) => n.toFixed(2)

export function buildCashFlow(opening: AccountSums[], closing: AccountSums[]): CashFlowStatement {
  const open = new Map(opening.map((r) => [r.accountId, r]))
  const byId = new Map<string, AccountSums>()
  for (const r of [...opening, ...closing]) byId.set(r.accountId, r)

  let income = 0
  let expense = 0
  let openingCash = 0
  let closingCash = 0
  const operating: CashFlowLine[] = []
  const investing: CashFlowLine[] = []
  const financing: CashFlowLine[] = []

  for (const [id, meta] of byId) {
    const before = open.get(id)
    const after = closing.find((r) => r.accountId === id)
    const balBefore = before ? accountBalance(meta.accountType, before.debit, before.credit) : 0
    const balAfter = after ? accountBalance(meta.accountType, after.debit, after.credit) : 0
    const delta = balAfter - balBefore
    if (meta.accountType === 'income') { income += delta; continue }
    if (meta.accountType === 'expense') { expense += delta; continue }
    if (isCash(meta.code)) { openingCash += balBefore; closingCash += balAfter; continue }
    if (Math.abs(delta) < 0.005) continue
    // assets: increase consumes cash; liabilities/equity: increase provides cash
    const cashEffect = meta.accountType === 'asset' ? -delta : delta
    const line = { code: meta.code, name: meta.name, amount: fix(cashEffect) }
    if (isAccumDepr(meta.code)) operating.push({ ...line, amount: fix(-delta) }) // contra-asset: credit growth = add-back
    else if (isFixedAsset(meta.code)) investing.push(line)
    else if (isFinancing(meta.code)) financing.push(line)
    else operating.push(line)
  }

  const netProfit = income - expense
  const sum = (rows: CashFlowLine[]) => rows.reduce((s, r) => s + Number(r.amount), 0)
  const totalOperating = netProfit + sum(operating)
  const totalInvesting = sum(investing)
  const totalFinancing = sum(financing)
  const netChange = totalOperating + totalInvesting + totalFinancing
  const sorter = (a: CashFlowLine, b: CashFlowLine) => a.code.localeCompare(b.code)
  return {
    netProfit: fix(netProfit),
    operating: operating.sort(sorter),
    investing: investing.sort(sorter),
    financing: financing.sort(sorter),
    totalOperating: fix(totalOperating),
    totalInvesting: fix(totalInvesting),
    totalFinancing: fix(totalFinancing),
    netChange: fix(netChange),
    openingCash: fix(openingCash),
    closingCash: fix(closingCash),
    reconciled: Math.abs(netChange - (closingCash - openingCash)) < 0.01,
  }
}
