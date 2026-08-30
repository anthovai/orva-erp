import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { hashAuthToken } from '@open-mercato/core/modules/auth/lib/tokenHash'
import { issueStaffSession, staffAuthCookieOptions } from '@/lib/staff-session'
import { RecoveryCode, SessionFlag, TotpCredential } from '../data/entities'
import { normalizeRecoveryCode, verifyTotp } from './totp'

export const MFA_PENDING_AUDIENCE = 'orva_mfa_pending'
export const MFA_PENDING_TTL_SECONDS = 300

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
 * Staff-session issuance (shared src/lib/staff-session.ts) with the
 * `mfa: true` claim, plus a session-flag row so refreshed tokens (which
 * rebuild claims and lose custom ones) stay trusted by the backend gate.
 */
export async function issueMfaVerifiedSession(
  container: AwilixContainer,
  em: EntityManager,
  params: { userId: string; tenantId: string; orgId: string | null; email: string },
): Promise<IssuedSession | null> {
  const issued = await issueStaffSession(container, em, { ...params, extraClaims: { mfa: true } })
  if (!issued) return null

  const flag = em.create(SessionFlag, {
    tenantId: params.tenantId,
    organizationId: params.orgId ?? issued.organizationId ?? '',
    userId: params.userId,
    sessionId: issued.sessionId,
    verifiedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  em.persist(flag)
  await em.flush()

  return { token: issued.token, sessionId: issued.sessionId }
}

export const authCookieOptions = staffAuthCookieOptions
