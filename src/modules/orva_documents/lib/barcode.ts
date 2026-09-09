/**
 * Barcodes for the lot label, as pure functions: a string in, an array of bar
 * widths out, and an SVG string on top of that. No dependency — both
 * symbologies are decades-old public standards with small tables, and a label
 * that will not scan is worse than no label, so the tables are covered by
 * tests against published reference encodings rather than trusted.
 *
 * Two symbologies, chosen for what a Thai cosmetics label meets in practice:
 *
 * - **EAN-13** for a variant that carries a 13-digit GS1 number — what a
 *   marketplace warehouse or a shop scanner expects on retail packaging.
 * - **Code 39** for everything else (the SKU): a self-checking, alphanumeric
 *   symbology every handheld scanner reads out of the box, with a table small
 *   enough to be verified by eye. Code 128 is denser but its 107-row table is
 *   exactly the kind of thing a transcription error hides in.
 */

export type Symbology = 'ean13' | 'code39'

/** Bars and spaces as widths in modules; `modules[0]` is a bar, then they alternate. */
export type Encoded = {
  symbology: Symbology
  /** The text a human reads under the bars. */
  text: string
  /** Widths of alternating bars and spaces, starting with a bar. */
  modules: number[]
}

// ───────────────────────── EAN-13 ────────────────────────────────────────────

/** Left-hand odd (L) parity digit patterns, 7 modules each, as bar/space widths. */
const EAN_L: Record<string, string> = {
  '0': '0001101', '1': '0011001', '2': '0010011', '3': '0111101', '4': '0100011',
  '5': '0110001', '6': '0101111', '7': '0111011', '8': '0110111', '9': '0001011',
}
/** Right-hand (R): L patterns inverted. */
const EAN_R: Record<string, string> = Object.fromEntries(
  Object.entries(EAN_L).map(([digit, bits]) => [digit, bits.replace(/[01]/g, (bit) => (bit === '0' ? '1' : '0'))]),
)
/**
 * Left-hand even (G) parity: the R patterns read backwards — not L reversed,
 * which is what the first draft of this file did and the reference test caught.
 */
const EAN_G: Record<string, string> = Object.fromEntries(
  Object.entries(EAN_R).map(([digit, bits]) => [digit, bits.split('').reverse().join('')]),
)
/** Parity of the six left digits, selected by the first (implicit) digit. */
const EAN_PARITY: Record<string, string> = {
  '0': 'LLLLLL', '1': 'LLGLGG', '2': 'LLGGLG', '3': 'LLGGGL', '4': 'LGLLGG',
  '5': 'LGGLLG', '6': 'LGGGLL', '7': 'LGLGLG', '8': 'LGLGGL', '9': 'LGGLGL',
}

/** The GS1 modulo-10 check digit for the first 12 digits. */
export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) throw new Error('EAN-13 needs 12 digits to compute a check digit')
  let sum = 0
  for (let i = 0; i < 12; i += 1) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3)
  return (10 - (sum % 10)) % 10
}

/** True for a 13-digit string whose last digit is the correct check digit. */
export function isValidEan13(value: string): boolean {
  return /^\d{13}$/.test(value) && ean13CheckDigit(value.slice(0, 12)) === Number(value[12])
}

/** Turns a bit string ('1' = bar module, '0' = space module) into run widths starting with a bar. */
function bitsToModules(bits: string): number[] {
  const modules: number[] = []
  let current = '1'
  let run = 0
  // EAN begins with a bar; a leading '0' would be an empty first bar, which
  // the widths array records as 0 so the alternation still holds.
  for (const bit of bits) {
    if (bit === current) run += 1
    else {
      modules.push(run)
      current = bit
      run = 1
    }
  }
  modules.push(run)
  return modules
}

/** Encodes a valid EAN-13 into its 95 modules. */
export function encodeEan13(value: string): Encoded {
  if (!isValidEan13(value)) throw new Error(`not a valid EAN-13: ${value}`)
  const parity = EAN_PARITY[value[0]]
  let bits = '101'
  for (let i = 1; i <= 6; i += 1) {
    const table = parity[i - 1] === 'L' ? EAN_L : EAN_G
    bits += table[value[i]]
  }
  bits += '01010'
  for (let i = 7; i <= 12; i += 1) bits += EAN_R[value[i]]
  bits += '101'
  return { symbology: 'ean13', text: value, modules: bitsToModules(bits) }
}

// ───────────────────────── Code 39 ───────────────────────────────────────────

/**
 * Code 39 patterns: nine elements (5 bars, 4 spaces) per character, 'w' wide
 * and 'n' narrow, bars and spaces alternating starting with a bar. Standard
 * table (ISO/IEC 16388).
 */
const CODE39: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw', B: 'nnwnnwnnw', C: 'wnwnnwnnn', D: 'nnnnwwnnw', E: 'wnnnwwnnn',
  F: 'nnwnwwnnn', G: 'nnnnnwwnw', H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn',
  K: 'wnnnnnnww', L: 'nnwnnnnww', M: 'wnwnnnnwn', N: 'nnnnwnnww', O: 'wnnnwnnwn',
  P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn', S: 'nnwnnnwwn', T: 'nnnnwnwwn',
  U: 'wwnnnnnnw', V: 'nwwnnnnnw', W: 'wwwnnnnnn', X: 'nwnnwnnnw', Y: 'wwnnwnnnn',
  Z: 'nwwnwnnnn', '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '$': 'nwnwnwnnn',
  '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn', '*': 'nwnnwnwnn',
}

/** Wide-to-narrow ratio. 3 is the usual choice for reliable scanning at small sizes. */
const CODE39_WIDE = 3

/** Encodes a Code 39 string (upper-cased; unsupported characters refused). */
export function encodeCode39(value: string): Encoded {
  const text = value.toUpperCase()
  if (text.length === 0 || text.length > 40) throw new Error('Code 39 needs 1–40 characters')
  for (const char of text) {
    if (char === '*' || !(char in CODE39)) throw new Error(`Code 39 cannot encode ${JSON.stringify(char)}`)
  }
  const modules: number[] = []
  const push = (pattern: string) => {
    for (const element of pattern) modules.push(element === 'w' ? CODE39_WIDE : 1)
    // inter-character gap: one narrow space
    modules.push(1)
  }
  push(CODE39['*'])
  for (const char of text) push(CODE39[char])
  push(CODE39['*'])
  // drop the trailing gap after the stop character
  modules.pop()
  return { symbology: 'code39', text, modules }
}

// ───────────────────────── SVG ───────────────────────────────────────────────

export type BarcodeSvgOptions = {
  /** Width of one module in user units (mm on the label). */
  moduleWidth?: number
  /** Bar height in user units. */
  height?: number
  /** Print the text under the bars. */
  withText?: boolean
}

/** Total width in modules, including the quiet zones the scanner needs. */
export function totalModules(encoded: Encoded): number {
  const quiet = encoded.symbology === 'ean13' ? 11 : 10
  return encoded.modules.reduce((sum, width) => sum + width, 0) + quiet * 2
}

/**
 * An inline SVG of the code: black bars on nothing (the label's own ground),
 * quiet zones on both sides, the human-readable text below when asked.
 * Pure string output so it renders in React (`dangerouslySetInnerHTML`) and in
 * the headless PDF printer alike.
 */
export function barcodeSvg(encoded: Encoded, options: BarcodeSvgOptions = {}): string {
  const moduleWidth = options.moduleWidth ?? 0.33
  const height = options.height ?? 12
  const withText = options.withText ?? true
  const quiet = encoded.symbology === 'ean13' ? 11 : 10
  const width = totalModules(encoded) * moduleWidth
  const textHeight = withText ? 3 : 0
  const parts: string[] = []
  let x = quiet * moduleWidth
  let isBar = true
  for (const run of encoded.modules) {
    if (isBar && run > 0) {
      parts.push(`<rect x="${x.toFixed(3)}" y="0" width="${(run * moduleWidth).toFixed(3)}" height="${height}" fill="#000"/>`)
    }
    x += run * moduleWidth
    isBar = !isBar
  }
  const text = withText
    ? `<text x="${(width / 2).toFixed(3)}" y="${(height + 2.6).toFixed(3)}" font-family="ui-monospace, monospace" font-size="2.6" text-anchor="middle" fill="#000">${escapeXml(encoded.text)}</text>`
    : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width.toFixed(3)} ${(height + textHeight).toFixed(3)}" ` +
    `width="${width.toFixed(3)}mm" height="${(height + textHeight).toFixed(3)}mm" role="img" aria-label="${escapeXml(encoded.text)}">` +
    parts.join('') +
    text +
    '</svg>'
  )
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[char] ?? char)
}

/**
 * The code a label should carry for a variant: EAN-13 when the variant has a
 * valid one, otherwise Code 39 of the SKU, otherwise nothing — a label with no
 * code is honest; a label with a code that will not scan is not.
 */
export function barcodeFor(variant: { barcode?: string | null; gtinType?: string | null; sku?: string | null }): Encoded | null {
  const gtin = (variant.barcode ?? '').replace(/\s+/g, '')
  if (gtin && isValidEan13(gtin) && (variant.gtinType ?? 'ean13') === 'ean13') return encodeEan13(gtin)
  const sku = (variant.sku ?? '').trim().toUpperCase()
  if (sku && /^[0-9A-Z\-. $/+%]{1,40}$/.test(sku)) return encodeCode39(sku)
  return null
}
