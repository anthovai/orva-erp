/**
 * Clean-room TOTP implementation on node:crypto.
 *
 * HOTP per RFC 4226 (HMAC-SHA-1, dynamic truncation), TOTP per RFC 6238
 * (30-second time steps), base32 per RFC 4648. Verified against the RFC test
 * vectors in __tests__/totp.test.ts. No third-party OTP library and nothing
 * derived from @open-mercato/enterprise.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export const TOTP_STEP_SECONDS = 30
export const TOTP_DIGITS = 6
/** Accept the previous/next step to absorb clock drift. */
export const TOTP_WINDOW = 1

export function base32Encode(buffer: Buffer): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return output
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '')
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index === -1) throw new Error('orva_mfa: invalid base32 character')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/** RFC 4226 HOTP: HMAC-SHA-1 over the 8-byte big-endian counter, truncated. */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8)
  // Counters fit in 2^53 for any realistic time step; write as two 32-bit halves.
  message.writeUInt32BE(Math.floor(counter / 0x100000000), 0)
  message.writeUInt32BE(counter >>> 0, 4)
  const digest = createHmac('sha1', secret).update(message).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const code =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3]
  return String(code % 10 ** digits).padStart(digits, '0')
}

export function totpStep(atMs: number, stepSeconds = TOTP_STEP_SECONDS): number {
  return Math.floor(atMs / 1000 / stepSeconds)
}

export function totpAt(secretBase32: string, atMs: number, digits = TOTP_DIGITS): string {
  return hotp(base32Decode(secretBase32), totpStep(atMs), digits)
}

function codesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/**
 * Verify a submitted code within ±TOTP_WINDOW steps. Returns the matched
 * time step (for the single-use replay guard) or null.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  atMs: number,
  window = TOTP_WINDOW,
): number | null {
  const normalized = code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(normalized)) return null
  const secret = base32Decode(secretBase32)
  const current = totpStep(atMs)
  for (let offset = -window; offset <= window; offset++) {
    const step = current + offset
    if (step < 0) continue
    if (codesEqual(hotp(secret, step), normalized)) return step
  }
  return null
}

/** 20 random bytes (160 bits) per RFC 4226 §4 recommendation. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

export function buildOtpauthUrl(secretBase32: string, accountName: string, issuer = 'Orva'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

/** Recovery code: 10 base32 chars grouped as XXXXX-XXXXX (~50 bits). */
export function generateRecoveryCode(): string {
  const raw = base32Encode(randomBytes(7)).slice(0, 10)
  return `${raw.slice(0, 5)}-${raw.slice(5)}`
}

export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '')
}
