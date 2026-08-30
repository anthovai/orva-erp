import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { verifyAudienceJwt } from '@open-mercato/shared/lib/auth/jwt'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { verifySchema } from '../../data/validators'
import {
  MFA_PENDING_AUDIENCE,
  authCookieOptions,
  findActiveCredential,
  issueMfaVerifiedSession,
  verifyChallengeCode,
} from '../../lib/service'

export const metadata = {
  // The caller holds only the orva_mfa_pending token, which is NOT a valid
  // staff token — this route does its own audience-scoped verification.
  POST: { requireAuth: false },
}

const responseSchema = z.object({ ok: z.boolean(), redirect: z.string().optional() })
const errorSchema = z.object({ error: z.string() })

function readAuthCookie(req: Request): string | null {
  const header = req.headers.get('cookie') ?? ''
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === 'auth_token') return decodeURIComponent(rest.join('='))
  }
  return null
}

/**
 * Completes the login step-up: validates the 5-minute pending token from the
 * auth_token cookie, checks the TOTP/recovery code, then performs the full
 * staff-session issuance (real session row + sid + `mfa: true` claim) and
 * swaps the cookie for the real token.
 */
export async function POST(req: Request) {
  const pendingToken = readAuthCookie(req)
  const claims = pendingToken ? verifyAudienceJwt(MFA_PENDING_AUDIENCE, pendingToken) : null
  if (!claims || typeof claims.sub !== 'string' || typeof claims.tenantId !== 'string') {
    return NextResponse.json({ error: 'Challenge expired — sign in again' }, { status: 401 })
  }
  const parsed = verifySchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const credential = await findActiveCredential(em, claims.tenantId, claims.sub)
  if (!credential) {
    // Enrollment vanished between login and challenge — fall back to login.
    return NextResponse.json({ error: 'MFA is not active for this account' }, { status: 401 })
  }

  const result = await verifyChallengeCode(em, credential, parsed.data.code)
  if (!result.ok) {
    if (result.reason === 'locked') {
      return NextResponse.json(
        { error: 'Too many attempts — try again later', retryAfterSeconds: result.retryAfterSeconds },
        { status: 423 },
      )
    }
    return NextResponse.json({ error: 'Invalid code' }, { status: 400 })
  }

  const issued = await issueMfaVerifiedSession(container, em, {
    userId: claims.sub,
    tenantId: claims.tenantId,
    orgId: (claims.orgId as string | null) ?? null,
    email: typeof claims.email === 'string' ? claims.email : '',
  })
  if (!issued) return NextResponse.json({ error: 'Account is no longer available' }, { status: 401 })

  const res = NextResponse.json({ ok: true, redirect: '/backend' })
  res.cookies.set('auth_token', issued.token, authCookieOptions())
  return res
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva MFA',
  summary: 'Complete the MFA login challenge',
  methods: {
    POST: {
      summary: 'Exchange a pending challenge token + TOTP/recovery code for a staff session',
      description:
        'Requires the short-lived orva_mfa_pending token issued at password login. On success the auth_token cookie becomes a full staff session carrying the mfa claim.',
      tags: ['Orva MFA'],
      requestBody: { schema: verifySchema },
      responses: [{ status: 200, description: 'Session issued.', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid code', schema: errorSchema },
        { status: 401, description: 'Missing/expired challenge token', schema: errorSchema },
        { status: 423, description: 'Locked out after repeated failures', schema: errorSchema },
      ],
    },
  },
}
