import { describe, expect, test } from '@jest/globals'
import {
  base32Decode,
  base32Encode,
  buildOtpauthUrl,
  generateRecoveryCode,
  generateTotpSecret,
  hotp,
  normalizeRecoveryCode,
  totpAt,
  verifyTotp,
} from '../totp'

// RFC 4226 Appendix D — secret "12345678901234567890" (ASCII).
const RFC4226_SECRET = Buffer.from('12345678901234567890', 'ascii')
const RFC4226_HOTP = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489']

// RFC 6238 Appendix B (SHA-1 rows) — same secret, 8 digits.
const RFC6238_CASES: Array<[number, string]> = [
  [59_000, '94287082'],
  [1_111_111_109_000, '07081804'],
  [1_111_111_111_000, '14050471'],
  [1_234_567_890_000, '89005924'],
  [2_000_000_000_000, '69279037'],
]

describe('base32 (RFC 4648)', () => {
  test('round-trips arbitrary buffers', () => {
    for (const text of ['f', 'fo', 'foo', 'foob', 'fooba', 'foobar']) {
      const buffer = Buffer.from(text, 'ascii')
      expect(base32Decode(base32Encode(buffer)).toString('ascii')).toBe(text)
    }
  })
  test('matches known vectors', () => {
    expect(base32Encode(Buffer.from('foobar', 'ascii'))).toBe('MZXW6YTBOI')
  })
})

describe('hotp (RFC 4226 Appendix D)', () => {
  test.each(RFC4226_HOTP.map((code, counter) => [counter, code]))('counter %i → %s', (counter, code) => {
    expect(hotp(RFC4226_SECRET, counter as number)).toBe(code)
  })
})

describe('totp (RFC 6238 Appendix B, SHA-1)', () => {
  const secretBase32 = base32Encode(RFC4226_SECRET)
  test.each(RFC6238_CASES)('at %i ms → %s', (atMs, code) => {
    expect(totpAt(secretBase32, atMs as number, 8)).toBe(code)
  })
})

describe('verifyTotp', () => {
  const secret = generateTotpSecret()
  const now = 1_756_000_000_000

  test('accepts the current step and returns it', () => {
    const code = totpAt(secret, now)
    expect(verifyTotp(secret, code, now)).toBe(Math.floor(now / 1000 / 30))
  })
  test('accepts ±1 step drift', () => {
    expect(verifyTotp(secret, totpAt(secret, now - 30_000), now)).not.toBeNull()
    expect(verifyTotp(secret, totpAt(secret, now + 30_000), now)).not.toBeNull()
  })
  test('rejects a two-step-old code and malformed input', () => {
    expect(verifyTotp(secret, totpAt(secret, now - 90_000), now)).toBeNull()
    expect(verifyTotp(secret, 'abc123', now)).toBeNull()
    expect(verifyTotp(secret, '12345', now)).toBeNull()
  })
})

describe('helpers', () => {
  test('secret is 32 base32 chars (160 bits)', () => {
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/)
  })
  test('otpauth url carries issuer, account, and params', () => {
    const url = buildOtpauthUrl('ABC234', 'user@orva.co')
    expect(url).toContain('otpauth://totp/Orva:user%40orva.co')
    expect(url).toContain('secret=ABC234')
    expect(url).toContain('period=30')
  })
  test('recovery code shape and normalization', () => {
    const code = generateRecoveryCode()
    expect(code).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/)
    expect(normalizeRecoveryCode(' abcde-23456 ')).toBe('ABCDE23456')
  })
})
