"use client"
import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type Status = { enrolled: boolean; pending: boolean; activatedAt: string | null }

async function api<T>(path: string, body?: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'include',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as T }
}

/** Self-service MFA lifecycle: enroll → confirm code → recovery codes → disable. */
export default function MfaSettingsPage() {
  const t = useT()
  const [status, setStatus] = React.useState<Status | null>(null)
  const [enrollment, setEnrollment] = React.useState<{ secret: string; otpauthUrl: string } | null>(null)
  const [recoveryCodes, setRecoveryCodes] = React.useState<string[] | null>(null)
  const [code, setCode] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const refresh = React.useCallback(async () => {
    const res = await api<Status>('/api/orva_mfa/status')
    if (res.ok) setStatus(res.data)
  }, [])
  React.useEffect(() => { void refresh() }, [refresh])

  const run = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try { await action() } finally { setBusy(false) }
  }

  const startEnroll = () => run(async () => {
    const res = await api<{ secret: string; otpauthUrl: string; error?: string }>('/api/orva_mfa/enroll', {})
    if (!res.ok) { setError(res.data.error ?? 'Failed'); return }
    setEnrollment({ secret: res.data.secret, otpauthUrl: res.data.otpauthUrl })
    setRecoveryCodes(null)
    await refresh()
  })

  const activate = () => run(async () => {
    const res = await api<{ recoveryCodes?: string[]; error?: string }>('/api/orva_mfa/activate', { code })
    if (!res.ok) { setError(res.data.error ?? t('orva_mfa.settings.invalidCode', 'Invalid code')); return }
    setRecoveryCodes(res.data.recoveryCodes ?? [])
    setEnrollment(null)
    setCode('')
    await refresh()
  })

  const disable = () => run(async () => {
    const res = await api<{ error?: string }>('/api/orva_mfa/disable', { code })
    if (!res.ok) { setError(res.data.error ?? t('orva_mfa.settings.invalidCode', 'Invalid code')); return }
    setCode('')
    setRecoveryCodes(null)
    await refresh()
  })

  return (
    <Page>
      <PageBody>
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
          <div>
            <h1 className="text-xl font-semibold">{t('orva_mfa.settings.title', 'Two-factor authentication')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('orva_mfa.settings.subtitle', 'Protect your account with a 6-digit code from an authenticator app.')}
            </p>
          </div>

          {status === null ? (
            <div className="rounded-lg border p-6 text-sm text-muted-foreground">{t('orva_mfa.settings.loading', 'Loading…')}</div>
          ) : status.enrolled ? (
            <div className="flex flex-col gap-4 rounded-lg border p-6">
              <div className="text-sm">
                <span className="mr-2 inline-flex items-center rounded-full border border-green-700/30 bg-green-600/10 px-2.5 py-0.5 text-xs font-semibold text-green-700">
                  {t('orva_mfa.settings.activeBadge', 'Active')}
                </span>
                {t('orva_mfa.settings.activeSince', 'Enabled since')}{' '}
                {status.activatedAt ? new Date(status.activatedAt).toLocaleString() : '—'}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  className="h-9 w-44 rounded-md border bg-background px-3 text-sm"
                  placeholder={t('orva_mfa.settings.codePlaceholder', 'Code or recovery code')}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  aria-label={t('orva_mfa.settings.codePlaceholder', 'Code or recovery code')}
                />
                <Button variant="destructive" disabled={busy || code.trim().length < 6} onClick={disable}>
                  {t('orva_mfa.settings.disable', 'Disable MFA')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4 rounded-lg border p-6">
              {enrollment === null ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    {t('orva_mfa.settings.notEnrolled', 'MFA is not enabled for your account yet.')}
                  </p>
                  <div>
                    <Button disabled={busy} onClick={startEnroll}>
                      {t('orva_mfa.settings.enroll', 'Set up authenticator')}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm">
                    {t('orva_mfa.settings.enterSecret', 'Add this key to your authenticator app (Google Authenticator, Microsoft Authenticator, 1Password …):')}
                  </p>
                  <code className="break-all rounded-md bg-muted px-3 py-2 font-mono text-sm">{enrollment.secret}</code>
                  <a href={enrollment.otpauthUrl} className="text-xs text-primary underline underline-offset-2">
                    {t('orva_mfa.settings.openInApp', 'Open directly in an authenticator app')}
                  </a>
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      className="h-9 w-36 rounded-md border bg-background px-3 text-center text-sm tracking-widest"
                      placeholder="000000"
                      inputMode="numeric"
                      maxLength={6}
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      aria-label={t('orva_mfa.settings.confirmCode', 'Confirmation code')}
                    />
                    <Button disabled={busy || code.trim().length !== 6} onClick={activate}>
                      {t('orva_mfa.settings.activate', 'Confirm and enable')}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {recoveryCodes ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-6">
              <h2 className="text-sm font-semibold">{t('orva_mfa.settings.recoveryTitle', 'Recovery codes — shown only once')}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('orva_mfa.settings.recoveryHint', 'Store these somewhere safe. Each code signs you in once if you lose your device.')}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-4">
                {recoveryCodes.map((recoveryCode) => (
                  <span key={recoveryCode} className="rounded bg-muted px-2 py-1 text-center">{recoveryCode}</span>
                ))}
              </div>
            </div>
          ) : null}

          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>
      </PageBody>
    </Page>
  )
}
