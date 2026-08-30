/**
 * Clean-room OIDC helpers on node:crypto + jose (already in the tree).
 * Authorization-code flow with PKCE (S256); the state/nonce/verifier round-
 * trip travels in a short-lived audience-scoped JWT cookie, following the
 * public state-cookie pattern in core's communication_channels module.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { signAudienceJwt, verifyAudienceJwt } from '@open-mercato/shared/lib/auth/jwt'

export const SSO_STATE_AUDIENCE = 'orva_sso_state'
export const SSO_STATE_TTL_SECONDS = 600
export const SSO_STATE_COOKIE = 'orva_sso_state'

export function extractEmailDomain(email: string): string | null {
  const at = email.lastIndexOf('@')
  if (at <= 0 || at === email.length - 1) return null
  return email.slice(at + 1).toLowerCase()
}

/** Does the stored comma-separated domain list claim this email's domain? */
export function domainsMatchEmail(emailDomains: string, email: string): boolean {
  const domain = extractEmailDomain(email)
  if (!domain) return false
  return emailDomains
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .includes(domain)
}

function base64url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function generatePkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(48))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

export function generateStateToken(): string {
  return base64url(randomBytes(24))
}

export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

export type SsoStatePayload = {
  state: string
  nonce: string
  verifier: string
  connectionId: string
  redirect: string
}

export function signStateCookie(payload: SsoStatePayload): string {
  return signAudienceJwt(SSO_STATE_AUDIENCE, { sub: payload.connectionId, ...payload }, SSO_STATE_TTL_SECONDS)
}

export function verifyStateCookie(token: string): SsoStatePayload | null {
  const claims = verifyAudienceJwt(SSO_STATE_AUDIENCE, token)
  if (
    !claims ||
    typeof claims.state !== 'string' ||
    typeof claims.nonce !== 'string' ||
    typeof claims.verifier !== 'string' ||
    typeof claims.connectionId !== 'string' ||
    typeof claims.redirect !== 'string'
  ) {
    return null
  }
  return {
    state: claims.state,
    nonce: claims.nonce,
    verifier: claims.verifier,
    connectionId: claims.connectionId,
    redirect: claims.redirect,
  }
}

export type OidcDiscovery = {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
}

/** Fetch <issuer>/.well-known/openid-configuration and validate the shape. */
export async function fetchDiscovery(issuerUrl: string): Promise<OidcDiscovery> {
  const base = issuerUrl.replace(/\/+$/, '')
  const res = await fetch(`${base}/.well-known/openid-configuration`, {
    signal: AbortSignal.timeout(8000),
    redirect: 'error',
  })
  if (!res.ok) throw new Error(`orva_sso: discovery failed (${res.status})`)
  const doc = (await res.json()) as Partial<OidcDiscovery>
  for (const key of ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
    if (typeof doc[key] !== 'string' || doc[key]!.length === 0) {
      throw new Error(`orva_sso: discovery document is missing ${key}`)
    }
  }
  return doc as OidcDiscovery
}

export function buildAuthorizeUrl(params: {
  discovery: OidcDiscovery
  clientId: string
  redirectUri: string
  state: string
  nonce: string
  codeChallenge: string
}): string {
  const url = new URL(params.discovery.authorization_endpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('state', params.state)
  url.searchParams.set('nonce', params.nonce)
  url.searchParams.set('code_challenge', params.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

/** Only same-site absolute paths are allowed as a post-login destination. */
export function sanitizeRedirectPath(input: string | null | undefined, fallback = '/backend'): string {
  if (!input) return fallback
  if (!input.startsWith('/') || input.startsWith('//') || input.includes('\\')) return fallback
  return input
}
