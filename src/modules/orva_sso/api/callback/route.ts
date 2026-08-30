import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { issueStaffSession, staffAuthCookieOptions } from '@/lib/staff-session'
import { SsoConnection } from '../../data/entities'
import { callbackQuerySchema } from '../../data/validators'
import {
  SSO_STATE_COOKIE,
  constantTimeEquals,
  domainsMatchEmail,
  fetchDiscovery,
  verifyStateCookie,
} from '../../lib/oidc'
import { exchangeCodeAndVerify } from '../../lib/idp-verify'

export const metadata = {
  GET: { requireAuth: false },
}

const logger = createLogger('orva_sso').child({ component: 'callback' })

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie') ?? ''
  for (const part of header.split(';')) {
    const [cookieName, ...rest] = part.trim().split('=')
    if (cookieName === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

function failure(origin: string, code: string): NextResponse {
  const res = NextResponse.redirect(new URL(`/login?error=${code}`, origin))
  res.cookies.set(SSO_STATE_COOKIE, '', { path: '/api/orva_sso', maxAge: 0 })
  return res
}

/**
 * OIDC redirect target: validates state, exchanges the code (PKCE), verifies
 * the ID token against the IdP's JWKS, then signs in the EXISTING user whose
 * email matches inside the connection's tenant — unknown emails fail closed
 * (no JIT provisioning). Successful sessions carry `idp` + `mfa: true`
 * claims (the IdP owns its own MFA; Orva does not double-challenge).
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const parsed = callbackQuerySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) return failure(url.origin, 'sso_invalid_callback')

  const stateCookie = readCookie(req, SSO_STATE_COOKIE)
  const statePayload = stateCookie ? verifyStateCookie(stateCookie) : null
  if (!statePayload || !constantTimeEquals(statePayload.state, parsed.data.state)) {
    return failure(url.origin, 'sso_state_mismatch')
  }

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  // Two-step read: the decryption scope needs the tenant id, which we only
  // know after loading the row (the state cookie carries the connection id).
  const scopeProbe = await em.findOne(SsoConnection, {
    id: statePayload.connectionId,
    enabled: true,
    deletedAt: null,
  })
  if (!scopeProbe) return failure(url.origin, 'sso_not_configured')
  em.clear()
  const connection = await findOneWithDecryption(
    em,
    SsoConnection,
    { id: statePayload.connectionId, enabled: true, deletedAt: null } as never,
    undefined,
    { tenantId: scopeProbe.tenantId, organizationId: scopeProbe.organizationId },
  )
  if (!connection) return failure(url.origin, 'sso_not_configured')

  let verified
  try {
    const discovery = await fetchDiscovery(connection.issuerUrl)
    verified = await exchangeCodeAndVerify({
      discovery,
      clientId: connection.clientId,
      clientSecret: connection.clientSecret,
      code: parsed.data.code,
      codeVerifier: statePayload.verifier,
      redirectUri: `${url.origin}/api/orva_sso/callback`,
      expectedNonce: statePayload.nonce,
    })
  } catch (error) {
    logger.warn('SSO token exchange/verification failed', {
      connectionId: connection.id,
      err: error instanceof Error ? error.message : String(error),
    })
    return failure(url.origin, 'sso_verification_failed')
  }

  // The IdP must only assert emails on domains this connection claims.
  if (!verified.emailVerified || !domainsMatchEmail(connection.emailDomains, verified.email)) {
    return failure(url.origin, 'sso_email_rejected')
  }

  const auth = container.resolve<AuthService>('authService')
  const user = await auth.findUserByEmailAndTenant(verified.email, connection.tenantId)
  if (!user) {
    // Existing users only — never provision from an IdP assertion.
    return failure(url.origin, 'sso_unknown_user')
  }

  const issued = await issueStaffSession(container, em, {
    userId: String(user.id),
    tenantId: connection.tenantId,
    orgId: user.organizationId ? String(user.organizationId) : null,
    email: verified.email,
    extraClaims: { idp: connection.id, mfa: true },
  })
  if (!issued) return failure(url.origin, 'sso_unknown_user')

  const res = NextResponse.redirect(new URL(statePayload.redirect, url.origin))
  res.cookies.set('auth_token', issued.token, staffAuthCookieOptions())
  res.cookies.set(SSO_STATE_COOKIE, '', { path: '/api/orva_sso', maxAge: 0 })
  return res
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva SSO',
  summary: 'SSO callback',
  methods: {
    GET: {
      summary: 'OIDC redirect target — verifies the ID token and signs in the existing user',
      tags: ['Orva SSO'],
      query: callbackQuerySchema,
      responses: [{ status: 307, description: 'Redirect into the app, or back to /login?error=… on any failure.', mediaType: 'text/html' }],
      errors: [{ status: 400, description: 'Invalid query', schema: z.object({ error: z.string() }) }],
    },
  },
}
