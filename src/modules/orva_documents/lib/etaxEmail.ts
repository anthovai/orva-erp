import { Resend } from 'resend'
import type * as React from 'react'

/** The e-Tax Invoice by Email program's fixed time-stamp CC address. */
export const ETAX_CC_ADDRESS = 'csemail@etax.teda.th'

const parseBoolean = (value: string | undefined) =>
  value != null && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())

/**
 * Sends an e-Tax Invoice email: buyer in TO, ETDA's time-stamp system in CC,
 * from the RD-REGISTERED sender, exactly one attachment — the program's rules
 * (ETDA e-Tax Invoice by Email).
 *
 * Exists because upstream's sendEmail helper has no `cc` — and TO-ing the
 * ETDA address instead would put the time-stamp system in the recipient line,
 * off-spec. Same Resend transport and kill-switch env vars as the helper, so
 * test runs and OM_DISABLE_EMAIL_DELIVERY behave identically.
 */
export async function sendEtaxEmail(options: {
  to: string
  from: string
  subject: string
  react: React.ReactNode
  attachment: { filename: string; content: string; contentType: string }
}): Promise<{ delivered: boolean }> {
  if (parseBoolean(process.env.OM_DISABLE_EMAIL_DELIVERY) || parseBoolean(process.env.OM_TEST_MODE)) {
    return { delivered: false }
  }
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY is not set')
  const resend = new Resend(apiKey)
  const result = await resend.emails.send({
    to: options.to,
    cc: ETAX_CC_ADDRESS,
    from: options.from,
    subject: options.subject,
    react: options.react,
    attachments: [options.attachment],
  })
  const errorMessage =
    typeof (result as { error?: unknown })?.error === 'string'
      ? String((result as { error?: unknown }).error)
      : typeof (result as { error?: { message?: unknown } })?.error?.message === 'string'
        ? String((result as { error?: { message?: unknown } }).error!.message)
        : null
  if (errorMessage) throw new Error(`RESEND_SEND_FAILED: ${errorMessage}`)
  return { delivered: true }
}
