/**
 * Token exchange + ID-token verification. Lives in its own module because
 * `jose` is ESM-only and would break jest loading lib/oidc.ts (which holds
 * the pure, unit-tested helpers).
 */
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { constantTimeEquals, type OidcDiscovery } from './oidc'

export type VerifiedIdToken = { email: string; emailVerified: boolean }

/**
 * Exchange the authorization code and verify the ID token against the
 * IdP's JWKS: signature, issuer, audience, expiry (jose) + nonce (manual).
 */
export async function exchangeCodeAndVerify(params: {
  discovery: OidcDiscovery
  clientId: string
  clientSecret: string
  code: string
  codeVerifier: string
  redirectUri: string
  expectedNonce: string
}): Promise<VerifiedIdToken> {
  const tokenRes = await fetch(params.discovery.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code_verifier: params.codeVerifier,
    }).toString(),
    signal: AbortSignal.timeout(10000),
  })
  if (!tokenRes.ok) {
    throw new Error(`orva_sso: token exchange failed (${tokenRes.status})`)
  }
  const tokens = (await tokenRes.json()) as { id_token?: string }
  if (typeof tokens.id_token !== 'string' || tokens.id_token.length === 0) {
    throw new Error('orva_sso: token response carries no id_token')
  }

  const jwks = createRemoteJWKSet(new URL(params.discovery.jwks_uri))
  const { payload } = await jwtVerify(tokens.id_token, jwks, {
    issuer: params.discovery.issuer,
    audience: params.clientId,
  })
  if (typeof payload.nonce !== 'string' || !constantTimeEquals(payload.nonce, params.expectedNonce)) {
    throw new Error('orva_sso: nonce mismatch')
  }
  if (typeof payload.email !== 'string' || payload.email.length === 0) {
    throw new Error('orva_sso: ID token carries no email claim')
  }
  return {
    email: payload.email.toLowerCase(),
    emailVerified: payload.email_verified !== false,
  }
}
