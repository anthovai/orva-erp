import { describe, expect, test } from '@jest/globals'
import { barcodeFor, barcodeSvg, ean13CheckDigit, encodeCode39, encodeEan13, isValidEan13, totalModules } from '../barcode'

/**
 * A code that will not scan is worse than no code, so the tables are checked
 * against published reference encodings, not against themselves.
 */

/** Widths back to a bit string, so an encoding can be compared to a reference. */
function toBits(modules: number[]): string {
  let bits = ''
  let bar = true
  for (const run of modules) {
    bits += (bar ? '1' : '0').repeat(run)
    bar = !bar
  }
  return bits
}

describe('EAN-13', () => {
  test('check digit follows GS1 modulo 10', () => {
    // The textbook example, and the two numbers the rehearsal uses.
    expect(ean13CheckDigit('590123412345')).toBe(7)
    expect(ean13CheckDigit('885900000001')).toBe(3)
    expect(ean13CheckDigit('400638133393')).toBe(1)
    expect(isValidEan13('5901234123457')).toBe(true)
    expect(isValidEan13('5901234123450')).toBe(false)
    expect(isValidEan13('590123412345')).toBe(false)
  })

  test('encodes the reference number to the published 95-module pattern', () => {
    // Widely published reference encoding of 5901234123457.
    const reference =
      '10100010110100111011001100100110111101001110101010110011011011001000010101110010011101000100101'
    const encoded = encodeEan13('5901234123457')
    expect(toBits(encoded.modules)).toBe(reference)
    expect(toBits(encoded.modules)).toHaveLength(95)
  })

  test('every EAN-13 is exactly 95 modules wide, whatever the digits', () => {
    for (const value of ['5901234123457', '8859000000013', '4006381333931', '0000000000000']) {
      expect(isValidEan13(value)).toBe(true)
      expect(toBits(encodeEan13(value).modules)).toHaveLength(95)
    }
    // starts and ends with the guard bars, centre guard in the middle
    const bits = toBits(encodeEan13('8859000000013').modules)
    expect(bits.startsWith('101')).toBe(true)
    expect(bits.endsWith('101')).toBe(true)
    expect(bits.slice(45, 50)).toBe('01010')
  })

  test('refuses a bad check digit rather than printing it', () => {
    expect(() => encodeEan13('8859000000019')).toThrow(/not a valid EAN-13/)
  })
})

describe('Code 39', () => {
  test('the start/stop character and a digit match the standard table', () => {
    // '*' is nwnnwnwnn: narrow bar, wide space, narrow bar, narrow space, wide
    // bar, narrow space, wide bar, narrow space, narrow bar — as widths with a
    // wide:narrow ratio of 3.
    const star = encodeCode39('0')
    expect(star.modules.slice(0, 9)).toEqual([1, 3, 1, 1, 3, 1, 3, 1, 1])
    // then the gap, then '0' = nnnwwnwnn
    expect(star.modules.slice(10, 19)).toEqual([1, 1, 1, 3, 3, 1, 3, 1, 1])
  })

  test('is self-consistent in length: (n + 2) characters × 9 elements + (n + 1) gaps', () => {
    for (const text of ['A', 'MV2609A', 'MRV-BL200-X1']) {
      const encoded = encodeCode39(text)
      const characters = text.length + 2
      expect(encoded.modules).toHaveLength(characters * 9 + (characters - 1))
      // every character has exactly three wide elements
      for (let i = 0; i < characters; i += 1) {
        const element = encoded.modules.slice(i * 10, i * 10 + 9)
        expect(element.filter((width) => width === 3)).toHaveLength(3)
      }
    }
  })

  test('upper-cases, and refuses what the symbology cannot carry', () => {
    expect(encodeCode39('mv2609a').text).toBe('MV2609A')
    expect(() => encodeCode39('ล็อต')).toThrow(/cannot encode/)
    expect(() => encodeCode39('A*B')).toThrow(/cannot encode/)
    expect(() => encodeCode39('')).toThrow()
  })
})

describe('which code a variant gets', () => {
  test('a valid EAN-13 wins; otherwise the SKU as Code 39; otherwise nothing', () => {
    expect(barcodeFor({ barcode: '8859000000013', gtinType: 'ean13', sku: 'MRV-BL200' })?.symbology).toBe('ean13')
    expect(barcodeFor({ barcode: '8859000000019', gtinType: 'ean13', sku: 'MRV-BL200' })?.symbology).toBe('code39')
    expect(barcodeFor({ barcode: null, gtinType: null, sku: 'MRV-BL200' })?.text).toBe('MRV-BL200')
    expect(barcodeFor({ barcode: null, gtinType: null, sku: 'ครีม' })).toBeNull()
    expect(barcodeFor({})).toBeNull()
  })
})

describe('SVG', () => {
  test('draws one rect per bar, leaves quiet zones, escapes the text', () => {
    const encoded = encodeEan13('8859000000013')
    const svg = barcodeSvg(encoded, { moduleWidth: 0.33, height: 12 })
    const bars = encoded.modules.filter((_, index) => index % 2 === 0 && encoded.modules[index] > 0).length
    expect((svg.match(/<rect /g) ?? []).length).toBe(bars)
    expect(svg).toContain('8859000000013')
    expect(svg).toContain(`viewBox="0 0 ${(totalModules(encoded) * 0.33).toFixed(3)}`)
    // the first bar starts after the quiet zone, never at x=0
    expect(svg).not.toContain('x="0.000" y="0"')
    const hostile = barcodeSvg({ symbology: 'code39', text: '<script>', modules: [1, 1, 1] })
    expect(hostile).not.toContain('<script>')
    expect(hostile).toContain('&lt;script&gt;')
  })
})
