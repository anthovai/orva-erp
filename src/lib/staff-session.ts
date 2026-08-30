import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { signJwt } from '@open-mercato/shared/lib/auth/jwt'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'

export const ACCESS_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 8

export type IssuedStaffSession = { token: string; sessionId: string; organizationId: string | null }

/**
 * Full staff-session issuance — the documented public sequence the core
 * autologin route uses: getUserRoles → updateLastLoginAt → createSession →
 * signJwt with a real `sid` (session-integrity rejects sid-less tokens).
 * Shared by the @orva/* auth modules (MFA verify, SSO callback), which add
 * their own claims (mfa, idp) via `extraClaims`.
 */
export async function issueStaffSession(
  container: AwilixContainer,
  em: EntityManager,
  params: {
    userId: string
    tenantId: string
    orgId: string | null
    email: string
    extraClaims?: Record<string, unknown>
  },
): Promise<IssuedStaffSession | null> {
  const auth = container.resolve<AuthService>('authService')
  const user = (await em.findOne('User' as never, { id: params.userId } as never)) as
    | { id: string; organizationId?: string | null }
    | null
  if (!user) return null

  const roles = await auth.getUserRoles(user as never, params.tenantId)
  await auth.updateLastLoginAt(user as never)
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_MAX_AGE_SECONDS * 1000)
  const { session } = await auth.createSession(user as never, expiresAt)

  const token = signJwt({
    sub: params.userId,
    sid: String(session.id),
    tenantId: params.tenantId,
    orgId: params.orgId,
    email: params.email,
    roles,
    ...(params.extraClaims ?? {}),
  })
  return {
    token,
    sessionId: String(session.id),
    organizationId: user.organizationId ? String(user.organizationId) : null,
  }
}

export function staffAuthCookieOptions() {
  return {
    httpOnly: true as const,
    path: '/' as const,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge: ACCESS_TOKEN_MAX_AGE_SECONDS,
  }
}
