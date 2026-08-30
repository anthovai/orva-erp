"use client"
import * as React from 'react'
import type { LoginFormWidgetContext } from '@open-mercato/core/modules/auth/frontend/login-injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'

/**
 * Login-form SSO discovery. Rendered in the `auth.login:form` spot: watches
 * the email field, asks /api/orva_sso/discover (boolean-only endpoint), and
 * when the domain has an enabled connection swaps the password submit for a
 * "Continue with SSO" override via the spot's AuthOverride contract.
 */
export default function SsoLoginWidget({ context }: { context: LoginFormWidgetContext }) {
  const t = useT()
  const { email, searchParams, setAuthOverride, setAuthOverridePending } = context
  const label = t('orva_sso.login.continue', 'Continue with SSO')

  React.useEffect(() => {
    if (!email || !email.includes('@') || email.endsWith('@')) {
      setAuthOverride(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      // Only mark the form pending for the duration of the actual lookup —
      // holding it across the debounce would keep the submit button disabled
      // (formReady = clientReady && !authOverridePending) while typing.
      setAuthOverridePending?.(true)
      try {
        const res = await fetch(`/api/orva_sso/discover?email=${encodeURIComponent(email)}`, { cache: 'no-store' })
        const data = (await res.json().catch(() => null)) as { sso?: boolean } | null
        if (cancelled) return
        if (res.ok && data?.sso) {
          setAuthOverride({
            providerId: 'orva_sso',
            providerLabel: label,
            onSubmit: () => {
              const params = new URLSearchParams({ email })
              const redirect = searchParams.get('redirect')
              if (redirect) params.set('redirect', redirect)
              // A full document navigation is required: /api/orva_sso/start is
              // a route handler that 302s to the external IdP and sets the
              // state cookie. The Next router cannot follow that.
              window.location.href = `/api/orva_sso/start?${params.toString()}`
            },
            hidePassword: true,
            hideRememberMe: true,
            hideForgotPassword: true,
          })
        } else {
          setAuthOverride(null)
        }
      } catch {
        if (!cancelled) setAuthOverride(null)
      } finally {
        if (!cancelled) setAuthOverridePending?.(false)
      }
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
      setAuthOverridePending?.(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, label])

  return null
}
