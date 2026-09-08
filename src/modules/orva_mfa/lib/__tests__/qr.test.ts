import { describe, expect, it } from '@jest/globals'
import { otpauthQrDataUrl } from '../qr'
import { buildOtpauthUrl } from '../totp'

describe('enrollment QR', () => {
  it('renders the otpauth URI as a PNG data URL', async () => {
    const url = buildOtpauthUrl('JBSWY3DPEHPK3PXP', 'owner@example.com')
    const dataUrl = await otpauthQrDataUrl(url)
    expect(dataUrl).not.toBeNull()
    expect(dataUrl!.startsWith('data:image/png;base64,')).toBe(true)
    // A 220px QR of a URI this long is a few KB; a truncated encoder output
    // would be far smaller, so the size is the cheap sanity check.
    expect(dataUrl!.length).toBeGreaterThan(1000)
  })

  it('returns null instead of throwing when the payload cannot be encoded', async () => {
    // Beyond what any QR version can hold: the screen must still offer the key.
    const dataUrl = await otpauthQrDataUrl('x'.repeat(8000))
    expect(dataUrl).toBeNull()
  })
})
