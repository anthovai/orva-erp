"use client"
import * as React from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'

/**
 * Login step-up challenge. Reached with only the short-lived
 * orva_mfa_pending token in the auth cookie; posts the TOTP or a recovery
 * code to /api/orva_mfa/verify, which swaps the cookie for a real session.
 */
export default function MfaChallengePage() {
  const t = useT()
  const [code, setCode] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/orva_mfa/verify', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      const data = (await res.json().catch(() => ({}))) as { redirect?: string; error?: string; retryAfterSeconds?: number }
      if (res.ok) {
        window.location.assign(data.redirect || '/backend')
        return
      }
      if (res.status === 401) {
        setError(t('orva_mfa.challenge.expired', 'Challenge expired — please sign in again'))
      } else if (res.status === 423) {
        setError(t('orva_mfa.challenge.locked', 'Too many attempts — try again in a moment'))
      } else {
        setError(data.error ?? t('orva_mfa.challenge.invalid', 'Invalid code'))
      }
    } catch {
      setError(t('orva_mfa.challenge.network', 'Connection failed — try again'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm rounded-xl border bg-background p-8 shadow-sm">
        <h1 className="text-lg font-semibold">
          {t('orva_mfa.challenge.title', 'Two-factor authentication')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('orva_mfa.challenge.subtitle', 'Enter the 6-digit code from your authenticator app, or a recovery code.')}
        </p>
        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          <input
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label={t('orva_mfa.challenge.codeLabel', 'Verification code')}
            className="h-11 rounded-md border bg-background px-3 text-center text-lg tracking-widest outline-none focus:ring-2 focus:ring-ring"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="000000"
            maxLength={16}
          />
          {error ? (
            <p role="alert" className="text-sm text-destructive">{error}</p>
          ) : null}
          <button
            type="submit"
            disabled={submitting || code.trim().length < 6}
            className="h-10 rounded-md bg-primary text-sm font-semibold text-primary-foreground transition disabled:opacity-50"
          >
            {submitting
              ? t('orva_mfa.challenge.verifying', 'Verifying…')
              : t('orva_mfa.challenge.submit', 'Verify')}
          </button>
        </form>
        <Link href="/login" className="mt-4 block text-center text-xs text-muted-foreground hover:underline">
          {t('orva_mfa.challenge.backToLogin', 'Back to sign in')}
        </Link>
      </div>
    </main>
  )
}
