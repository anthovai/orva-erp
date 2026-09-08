import QRCode from 'qrcode'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('orva_mfa').child({ component: 'qr' })

/**
 * The enrollment QR, rendered on the server.
 *
 * `2026-08-30-orva-mfa-sso-clean-room.md` deferred this at Q4 for one reason:
 * it needs a dependency, and adding one is the owner's call. Approved
 * 2026-09-08; `qrcode` is MIT and so is every package in its tree.
 *
 * Server-side on purpose. The image is produced where the secret already is,
 * so the browser bundle does not grow by an encoder and the client never has
 * to hold the otpauth URI in order to draw it.
 *
 * A failure here is never fatal: the screen still shows the key to type and
 * the `otpauth://` link to tap, which is exactly what it showed before this
 * existed. So the caller gets `null` and enrollment carries on.
 */
export async function otpauthQrDataUrl(otpauthUrl: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(otpauthUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 220,
      // Plain black on white: a themed QR is a QR some scanners refuse.
      color: { dark: '#000000ff', light: '#ffffffff' },
    })
  } catch (err) {
    // Never log the URI — it carries the shared secret.
    logger.warn('Could not render the enrollment QR; the key and link still work', { err })
    return null
  }
}
