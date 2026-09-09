import { splitInclusiveReceipt } from './ap'

/**
 * What the ค่าใช้จ่ายจ่ายสด screen will post, computed from the questions the
 * owner answers about the receipt in hand — so the preview card and the
 * payload are the same arithmetic, and the route's contract stays exactly
 * what it was: `amount` is the gross total for `none`/`inclusive` and the net
 * for `exclusive`, with `vatAmount` typed only in `exclusive`.
 */
export type ReceiptKind = 'plain' | 'full'

export type ExpenseDraft = {
  /** the last line of the receipt — always what the owner typed */
  gross: number
  kind: ReceiptKind
  /** VAT as printed, when it differs from the automatic 7% split; null = automatic */
  vatOverride: number | null
  whtOn: boolean
  /** percent, e.g. 3 */
  whtRate: number
  /** hand-edited withholding; null = computed from net × rate */
  whtAmount: number | null
}

export type ExpensePosting = {
  net: number
  vat: number
  wht: number
  cashOut: number
  payload: {
    amount: number
    vatMode: 'none' | 'inclusive' | 'exclusive'
    vatAmount: number
    whtAmount: number
    whtRate: number | null
  }
  /** blocking problems, as translation keys the screen renders */
  errors: Array<'gross' | 'vat' | 'wht'>
}

const round2 = (value: number) => Math.round(value * 100) / 100

export function computeExpensePosting(draft: ExpenseDraft): ExpensePosting {
  const gross = round2(Number.isFinite(draft.gross) ? draft.gross : 0)
  const errors: ExpensePosting['errors'] = []
  if (!(gross > 0)) errors.push('gross')

  let net = gross
  let vat = 0
  let vatMode: ExpensePosting['payload']['vatMode'] = 'none'
  if (draft.kind === 'full') {
    if (draft.vatOverride === null) {
      const split = splitInclusiveReceipt(gross)
      net = split.net
      vat = split.vat
      vatMode = 'inclusive'
    } else {
      vat = round2(Math.max(0, draft.vatOverride))
      net = round2(gross - vat)
      vatMode = 'exclusive'
      if (gross > 0 && vat >= gross) errors.push('vat')
    }
  }

  const rate = draft.whtOn && Number.isFinite(draft.whtRate) ? Math.min(100, Math.max(0, draft.whtRate)) : 0
  const wht = draft.whtOn ? round2(draft.whtAmount ?? net * rate / 100) : 0
  if (draft.whtOn && net > 0 && wht >= net) errors.push('wht')

  return {
    net,
    vat,
    wht,
    cashOut: round2(net + vat - wht),
    payload: {
      amount: vatMode === 'exclusive' ? net : gross,
      vatMode,
      vatAmount: vatMode === 'exclusive' ? vat : 0,
      whtAmount: wht,
      whtRate: draft.whtOn ? rate : null,
    },
    errors,
  }
}

/** The withholding the screen proposes before the owner edits it. */
export function suggestedWithholding(net: number, ratePercent: number): number {
  return round2(net * ratePercent / 100)
}
