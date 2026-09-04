/**
 * PromptPay merchant-presented QR payload — EMVCo MPM as profiled by the Bank
 * of Thailand (Thai QR Payment standard).
 *
 * Structure is TLV: 2-digit tag, 2-digit length, value. The parts that matter:
 *   00 payload format "01" · 01 point-of-initiation ("11" reusable, "12" when
 *   an amount is embedded, i.e. one document = one scan) · 29 merchant account
 *   info carrying the PromptPay AID plus the proxy id · 53 currency 764 (THB)
 *   · 54 amount · 58 country TH · 63 CRC-16/CCITT-FALSE over everything
 *   including its own "6304" header.
 *
 * Kept dependency-free and pure so the format is unit-tested; only the QR
 * *image* uses the `qrcode` package, in the source layer.
 */

export const PROMPTPAY_AID = 'A000000677010111'

export type PromptPayIdKind = 'phone' | 'tax_id' | 'ewallet'

/** "095-354-0430" → { kind: 'phone', value: '0953540430' }; rejects anything that is not a PromptPay proxy. */
export function normalizePromptPayId(raw: string): { kind: PromptPayIdKind; value: string } | null {
  const digits = raw.replace(/[^0-9]/g, '')
  if (/^0\d{9}$/.test(digits)) return { kind: 'phone', value: digits }
  if (/^\d{13}$/.test(digits)) return { kind: 'tax_id', value: digits }
  if (/^\d{15}$/.test(digits)) return { kind: 'ewallet', value: digits }
  return null
}

/** The proxy value as transmitted: phones become 0066 + the 9 digits after the leading zero. */
function proxyValue(id: { kind: PromptPayIdKind; value: string }): { subTag: string; value: string } {
  if (id.kind === 'phone') return { subTag: '01', value: `0066${id.value.slice(1)}` }
  if (id.kind === 'tax_id') return { subTag: '02', value: id.value }
  return { subTag: '03', value: id.value }
}

const tlv = (tag: string, value: string) => `${tag}${String(value.length).padStart(2, '0')}${value}`

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), uppercase hex — EMVCo tag 63. */
export function crc16ccitt(input: string): string {
  let crc = 0xffff
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/**
 * The full QR payload. `amount` in baht; omit for a reusable no-amount QR.
 * Throws on an id that is not a valid PromptPay proxy — a wrong QR that banks
 * scan into someone else's account is worse than no QR.
 */
export function buildPromptPayPayload(rawId: string, amount?: number | null): string {
  const id = normalizePromptPayId(rawId)
  if (!id) throw new Error(`orva_documents: "${rawId}" is not a PromptPay id (phone, 13-digit tax id, or 15-digit e-wallet)`)
  const hasAmount = amount != null && Number.isFinite(amount) && amount > 0
  const proxy = proxyValue(id)
  const merchantInfo = tlv('00', PROMPTPAY_AID) + tlv(proxy.subTag, proxy.value)
  let payload =
    tlv('00', '01') +
    tlv('01', hasAmount ? '12' : '11') +
    tlv('29', merchantInfo) +
    tlv('53', '764') +
    (hasAmount ? tlv('54', amount.toFixed(2)) : '') +
    tlv('58', 'TH')
  payload += '6304'
  return payload + crc16ccitt(payload)
}

/** "0625568000896" → "0-6255-68000-89-6"-style display is bank-specific; keep it plain but grouped for reading. */
export function formatPromptPayId(rawId: string): string {
  const id = normalizePromptPayId(rawId)
  if (!id) return rawId
  if (id.kind === 'phone') return `${id.value.slice(0, 3)}-${id.value.slice(3, 6)}-${id.value.slice(6)}`
  return id.value
}
