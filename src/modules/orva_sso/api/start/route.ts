import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { SsoConnection } from '../../data/entities'
import { startQuerySchema } from '../../data/validators'
import {
  SSO_STATE_COOKIE,
  SSO_STATE_TTL_SECONDS,
  buildAuthorizeUrl,
  domainsMatchEmail,
  fetchDiscovery,
  generatePkcePair,
  generateStateToken,
  sanitizeRedirectPath,
  signStateCookie,
} from '../../lib/oidc'

export const metadata = {
  GET: { requireAuth: false },
}

/**
 * Starts the OIDC authorization-code + PKCE flow: resolves the connection
 * by email domain, fetches the IdP discovery document, stores
 * state/nonce/verifier in a signed 10-minute cookie, and redirects to the
 * IdP's authorize endpoint.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const parsed = startQuerySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid query' }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const connections = await em.find(SsoConnection, { enabled: true, deletedAt: null })
  const connection = connections.find((candidate) => domainsMatchEmail(candidate.emailDomains, parsed.data.email))
  if (!connection) {
    return NextResponse.redirect(new URL('/login?error=sso_not_configured', url.origin))
  }

  let discovery
  try {
    discovery = await fetchDiscovery(connection.issuerUrl)
  } catch {
    return NextResponse.redirect(new URL('/login?error=sso_idp_unreachable', url.origin))
  }

  const state = generateStateToken()
  const nonce = generateStateToken()
  const { verifier, challenge } = generatePkcePair()
  const redirectUri = `${url.origin}/api/orva_sso/callback`

  const res = NextResponse.redirect(
    buildAuthorizeUrl({
      discovery,
      clientId: connection.clientId,
      redirectUri,
      state,
      nonce,
      codeChallenge: challenge,
    }),
  )
  res.cookies.set(
    SSO_STATE_COOKIE,
    signStateCookie({
      state,
      nonce,
      verifier,
      connectionId: connection.id,
      redirect: sanitizeRedirectPath(parsed.data.redirect),
    }),
    {
      httpOnly: true,
      path: '/api/orva_sso',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: SSO_STATE_TTL_SECONDS,
    },
  )
  return res
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva SSO',
  summary: 'Start the SSO login flow',
  methods: {
    GET: {
      summary: 'Redirect to the identity provider (authorization code + PKCE)',
      tags: ['Orva SSO'],
      query: startQuerySchema,
      responses: [{ status: 307, description: 'Redirect to the IdP authorize endpoint (or back to /login on failure).', mediaType: 'text/html' }],
      errors: [{ status: 400, description: 'Invalid query', schema: z.object({ error: z.string() }) }],
    },
  },
}
