import { describe, expect, test } from '@jest/globals'
import { buildPromptPayPayload, crc16ccitt, formatPromptPayId, normalizePromptPayId, PROMPTPAY_AID } from '../promptpay'

/**
 * Independent CRC-16/CCITT-FALSE (table-driven, distinct from the
 * implementation's bit loop) so the checksum is verified, not copied.
 */
function referenceCrc(input: string): string {
  const table: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n << 8
    for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff
    table[n] = c
  }
  let crc = 0xffff
  for (let i = 0; i < input.length; i++) {
    crc = ((crc << 8) & 0xffff) ^ table[((crc >> 8) ^ input.charCodeAt(i)) & 0xff]
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/** Minimal TLV parser to prove the payload structure, not just eyeball it. */
function parseTlv(payload: string): Record<string, string> {
  const out: Record<string, string> = {}
  let i = 0
  while (i < payload.length) {
    const tag = payload.slice(i, i + 2)
    const len = Number(payload.slice(i + 2, i + 4))
    out[tag] = payload.slice(i + 4, i + 4 + len)
    i += 4 + len
  }
  return out
}

describe('PromptPay payload', () => {
  test('CRC matches the standard test vector and an independent implementation', () => {
    expect(crc16ccitt('123456789')).toBe('29B1') // CRC-16/CCITT-FALSE check value
    const sample = '00020101021129370016A000000677010111011300669535404305303764'
    expect(crc16ccitt(sample)).toBe(referenceCrc(sample))
  })

  test("Kaiser's tax id with an invoice amount: tag 29 carries the AID + 13-digit proxy, tag 54 the amount, CRC verifies", () => {
    const payload = buildPromptPayPayload('0625568000896', 25680)
    const tags = parseTlv(payload)
    expect(tags['00']).toBe('01')
    expect(tags['01']).toBe('12') // amount embedded → one-time
    const merchant = parseTlv(tags['29'])
    expect(merchant['00']).toBe(PROMPTPAY_AID)
    expect(merchant['02']).toBe('0625568000896')
    expect(tags['53']).toBe('764')
    expect(tags['54']).toBe('25680.00')
    expect(tags['58']).toBe('TH')
    expect(tags['63']).toBe(referenceCrc(payload.slice(0, -4)))
  })

  test('a phone id becomes 0066 + 9 digits under sub-tag 01, and no amount means a reusable QR', () => {
    const payload = buildPromptPayPayload('095-354-0430')
    const tags = parseTlv(payload)
    expect(tags['01']).toBe('11')
    expect(tags['54']).toBeUndefined()
    expect(parseTlv(tags['29'])['01']).toBe('0066953540430')
  })

  test('ids normalize from human formatting and invalid ids are refused', () => {
    expect(normalizePromptPayId('095-354-0430')).toEqual({ kind: 'phone', value: '0953540430' })
    expect(normalizePromptPayId('0625568000896')).toEqual({ kind: 'tax_id', value: '0625568000896' })
    expect(normalizePromptPayId('123456789012345')).toEqual({ kind: 'ewallet', value: '123456789012345' })
    expect(normalizePromptPayId('12345')).toBeNull()
    expect(() => buildPromptPayPayload('12345')).toThrow(/PromptPay/)
    expect(formatPromptPayId('0953540430')).toBe('095-354-0430')
  })
})
