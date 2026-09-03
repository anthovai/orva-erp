/**
 * Pure matching of a bank-transfer slip to open invoices.
 *
 * A Thai customer paying a service invoice usually transfers the gross
 * amount MINUS 3% withholding tax on the pre-VAT amount (they remit that 3%
 * to the RD and hand us a 50 ทวิ). So a slip for 24,960 against a 25,680
 * invoice (24,000 + 7% VAT) is a full settlement with 720 withheld, not a
 * short payment. This module turns "slip amount + open invoices" into a
 * ranked list of candidate receipts the agent can propose.
 */
export type OpenInvoice = {
  id: string
  number: string
  customer: string | null
  /** pre-VAT amount */
  net: number
  /** gross (with VAT) */
  gross: number
  /** still unpaid, gross */
  remaining: number
  dueDate: string | null
}

export type SlipCandidate = {
  invoiceId: string
  invoiceNumber: string
  customer: string | null
  /** how the slip amount was explained */
  kind: 'full' | 'full_less_wht' | 'partial'
  cashReceived: number
  wht: number
  whtRate: number
  /** slip amount − explained amount; 0 for exact matches */
  difference: number
  /** 0..1, higher = more confident */
  score: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** WHT withheld when the customer applies `rate` to the pre-VAT amount. */
export function withholdingFor(net: number, rate = 0.03): number {
  return round2(net * rate)
}

/**
 * Rank open invoices against a slip amount. Exact full or full-less-WHT
 * matches score highest; partial payments (slip below remaining) rank by how
 * close they are; anything above the remaining amount is not a candidate.
 */
export function matchSlipToInvoices(amount: number, invoices: OpenInvoice[], opts: { tolerance?: number; whtRates?: number[] } = {}): SlipCandidate[] {
  const tolerance = opts.tolerance ?? 0.01
  const whtRates = opts.whtRates ?? [0.03, 0.01, 0.02, 0.05]
  const out: SlipCandidate[] = []
  for (const inv of invoices) {
    if (inv.remaining <= 0) continue
    const base = { invoiceId: inv.id, invoiceNumber: inv.number, customer: inv.customer }
    if (Math.abs(amount - inv.remaining) <= tolerance) {
      out.push({ ...base, kind: 'full', cashReceived: round2(inv.remaining), wht: 0, whtRate: 0, difference: 0, score: 1 })
      continue
    }
    let matched = false
    for (const rate of whtRates) {
      const wht = withholdingFor(inv.net, rate)
      const expected = round2(inv.remaining - wht)
      if (Math.abs(amount - expected) <= tolerance) {
        out.push({ ...base, kind: 'full_less_wht', cashReceived: round2(amount), wht, whtRate: rate, difference: 0, score: rate === 0.03 ? 0.98 : 0.9 })
        matched = true
        break
      }
    }
    if (matched) continue
    if (amount < inv.remaining) {
      const ratio = amount / inv.remaining
      out.push({ ...base, kind: 'partial', cashReceived: round2(amount), wht: 0, whtRate: 0, difference: round2(amount - inv.remaining), score: round2(0.3 + 0.4 * ratio) })
    }
  }
  return out.sort((a, b) => b.score - a.score || (a.difference === 0 ? -1 : 1))
}

/** "24,960.00", "24960", "฿24,960.-", "24,960.00 บาท" → 24960 */
export function parseThaiAmount(text: string): number | null {
  const cleaned = text.replace(/[฿,\s]/g, '').replace(/บาท|THB|\.-$/gi, '')
  const match = cleaned.match(/\d+(?:\.\d{1,2})?/)
  if (!match) return null
  const value = Number(match[0])
  return Number.isFinite(value) && value > 0 ? value : null
}

const THAI_MONTHS: Record<string, number> = {
  'ม.ค.': 1, 'มค': 1, 'มกราคม': 1, 'ก.พ.': 2, 'กพ': 2, 'กุมภาพันธ์': 2, 'มี.ค.': 3, 'มีค': 3, 'มีนาคม': 3,
  'เม.ย.': 4, 'เมย': 4, 'เมษายน': 4, 'พ.ค.': 5, 'พค': 5, 'พฤษภาคม': 5, 'มิ.ย.': 6, 'มิย': 6, 'มิถุนายน': 6,
  'ก.ค.': 7, 'กค': 7, 'กรกฎาคม': 7, 'ส.ค.': 8, 'สค': 8, 'สิงหาคม': 8, 'ก.ย.': 9, 'กย': 9, 'กันยายน': 9,
  'ต.ค.': 10, 'ตค': 10, 'ตุลาคม': 10, 'พ.ย.': 11, 'พย': 11, 'พฤศจิกายน': 11, 'ธ.ค.': 12, 'ธค': 12, 'ธันวาคม': 12,
}

/**
 * Slip dates come as "31 ส.ค. 69", "31/08/2569", "2026-08-31" or
 * "31 Aug 2026". Buddhist years (>= 2400) are converted. Returns YYYY-MM-DD.
 */
export function parseThaiDate(text: string): string | null {
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return normalize(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const slash = text.match(/(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})/)
  if (slash) return normalize(Number(slash[3]), Number(slash[2]), Number(slash[1]))
  const thai = text.match(/(\d{1,2})\s*(ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.|มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม|มค|กพ|มีค|เมย|พค|มิย|กค|สค|กย|ตค|พย|ธค)\s*(\d{2,4})/)
  if (thai) return normalize(Number(thai[3]), THAI_MONTHS[thai[2]], Number(thai[1]))
  const en = text.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{2,4})/i)
  if (en) {
    const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(en[2].slice(0, 3).toLowerCase()) + 1
    return normalize(Number(en[3]), month, Number(en[1]))
  }
  return null
}

function normalize(year: number, month: number, day: number): string | null {
  if (!month || month < 1 || month > 12 || !day || day < 1 || day > 31) return null
  let y = year
  if (y < 100) y += y >= 43 ? 2500 : 2000 // "69" → 2569 (BE), "26" → 2026
  if (y >= 2400) y -= 543
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
