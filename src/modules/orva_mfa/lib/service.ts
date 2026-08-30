import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { signJwt } from '@open-mercato/shared/lib/auth/jwt'
import { hashAuthToken } from '@open-mercato/core/modules/auth/lib/tokenHash'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { RecoveryCode, SessionFlag, TotpCredential } from '../data/entities'
import { normalizeRecoveryCode, verifyTotp } from './totp'

export const MFA_PENDING_AUDIENCE = 'orva_mfa_pending'
export const MFA_PENDING_TTL_SECONDS = 300
export const ACCESS_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 8

const MAX_FAILED_ATTEMPTS = 5
const BASE_LOCK_SECONDS = 60
const MAX_LOCK_SECONDS = 15 * 60

export async function findActiveCredential(
  em: EntityManager,
  tenantId: string,
  userId: string,
): Promise<TotpCredential | null> {
  // Decryption map covers `secret`; scope is required for the tenant key.
  return findOneWithDecryption(
    em,
    TotpCredential,
    { tenantId, userId, status: 'active', deletedAt: null } as never,
    undefined,
    { tenantId },
  )
}

export type ChallengeResult =
  | { ok: true; method: 'totp' | 'recovery' }
  | { ok: false; reason: 'locked' | 'invalid'; retryAfterSeconds?: number }

/**
 * Verify a TOTP code (with replay guard) or an unused recovery code against
 * the user's active credential. Mutates lockout counters / used_at and
 * flushes — callers get a settled result.
 */
export async function verifyChallengeCode(
  em: EntityManager,
  credential: TotpCredential,
  rawCode: string,
): Promise<ChallengeResult> {
  const now = new Date()
  if (credential.lockedUntil && credential.lockedUntil > now) {
    return {
      ok: false,
      reason: 'locked',
      retryAfterSeconds: Math.ceil((credential.lockedUntil.getTime() - now.getTime()) / 1000),
    }
  }

  const compact = rawCode.replace(/\s/g, '')
  // 6-digit → TOTP path with a single-use step guard.
  if (/^\d{6}$/.test(compact)) {
    const step = verifyTotp(credential.secret, compact, now.getTime())
    const lastStep = credential.lastUsedStep ? Number(credential.lastUsedStep) : null
    if (step !== null && (lastStep === null || step > lastStep)) {
      credential.lastUsedStep = String(step)
      credential.failedAttempts = 0
      credential.lockedUntil = null
      await em.flush()
      return { ok: true, method: 'totp' }
    }
    return await registerFailure(em, credential, now)
  }

  // Otherwise try recovery codes (hashed, single use).
  const normalized = normalizeRecoveryCode(rawCode)
  if (normalized.length >= 8) {
    const hash = hashAuthToken(normalized)
    const match = await em.findOne(RecoveryCode, {
      tenantId: credential.tenantId,
      userId: credential.userId,
      codeHash: hash,
      usedAt: null,
      deletedAt: null,
    })
    if (match) {
      match.usedAt = now
      credential.failedAttempts = 0
      credential.lockedUntil = null
      await em.flush()
      return { ok: true, method: 'recovery' }
    }
  }
  return await registerFailure(em, credential, now)
}

async function registerFailure(
  em: EntityManager,
  credential: TotpCredential,
  now: Date,
): Promise<ChallengeResult> {
  credential.failedAttempts += 1
  if (credential.failedAttempts >= MAX_FAILED_ATTEMPTS) {
    const over = credential.failedAttempts - MAX_FAILED_ATTEMPTS
    const lockSeconds = Math.min(BASE_LOCK_SECONDS * 2 ** over, MAX_LOCK_SECONDS)
    credential.lockedUntil = new Date(now.getTime() + lockSeconds * 1000)
  }
  await em.flush()
  return { ok: false, reason: 'invalid' }
}

export type IssuedSession = { token: string; sessionId: string }

/**
 * Full staff-session issuance — the documented public sequence used by the
 * core autologin route: getUserRoles → updateLastLoginAt → createSession →
 * signJwt with a real `sid`. Adds the `mfa: true` claim and records the
 * session flag so refreshed tokens (which lose custom claims) stay trusted.
 */
export async function issueMfaVerifiedSession(
  container: AwilixContainer,
  em: EntityManager,
  params: { userId: string; tenantId: string; orgId: string | null; email: string },
): Promise<IssuedSession | null> {
  const auth = container.resolve<AuthService>('authService')
  const user = (await em.findOne('User' as never, { id: params.userId } as never)) as
    | { id: string; organizationId?: string | null }
    | null
  if (!user) return null

  const roles = await auth.getUserRoles(user as never, params.tenantId)
  await auth.updateLastLoginAt(user as never)
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_MAX_AGE_SECONDS * 1000)
  const { session } = await auth.createSession(user as never, expiresAt)

  const flag = em.create(SessionFlag, {
    tenantId: params.tenantId,
    organizationId: params.orgId ?? String(user.organizationId ?? ''),
    userId: params.userId,
    sessionId: String(session.id),
    verifiedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  em.persist(flag)
  await em.flush()

  const token = signJwt({
    sub: params.userId,
    sid: String(session.id),
    tenantId: params.tenantId,
    orgId: params.orgId,
    email: params.email,
    roles,
    mfa: true,
  })
  return { token, sessionId: String(session.id) }
}

export function authCookieOptions() {
  return {
    httpOnly: true as const,
    path: '/' as const,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge: ACCESS_TOKEN_MAX_AGE_SECONDS,
  }
}
