import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { hashAuthToken } from '@open-mercato/core/modules/auth/lib/tokenHash'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { RecoveryCode, TotpCredential } from '../../data/entities'
import { activateSchema } from '../../data/validators'
import { generateRecoveryCode, normalizeRecoveryCode, verifyTotp } from '../../lib/totp'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['orva_mfa.self'] },
}

const RECOVERY_CODE_COUNT = 8

const responseSchema = z.object({ ok: z.boolean(), recoveryCodes: z.array(z.string()) })

/**
 * Confirms enrollment with a first valid TOTP code, activates the
 * credential, and returns a fresh batch of single-use recovery codes —
 * shown exactly once, stored only as hashes.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = activateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const credential = await findOneWithDecryption(
    em,
    TotpCredential,
    { tenantId: auth.tenantId, userId: auth.sub, status: 'pending', deletedAt: null } as never,
    undefined,
    { tenantId: auth.tenantId },
  )
  if (!credential) return Response.json({ error: 'No pending enrollment — enroll first' }, { status: 400 })

  const step = verifyTotp(credential.secret, parsed.data.code, Date.now())
  if (step === null) return Response.json({ error: 'Invalid code' }, { status: 400 })

  const now = new Date()
  const previous = await em.find(RecoveryCode, {
    tenantId: auth.tenantId,
    userId: auth.sub,
    deletedAt: null,
  })

  credential.status = 'active'
  credential.activatedAt = now
  credential.lastUsedStep = String(step)
  credential.failedAttempts = 0
  credential.lockedUntil = null
  previous.forEach((code) => { code.deletedAt = now })

  const plainCodes: string[] = []
  for (let index = 0; index < RECOVERY_CODE_COUNT; index++) {
    const code = generateRecoveryCode()
    plainCodes.push(code)
    em.persist(
      em.create(RecoveryCode, {
        tenantId: auth.tenantId,
        organizationId: credential.organizationId,
        userId: auth.sub,
        codeHash: hashAuthToken(normalizeRecoveryCode(code)),
        createdAt: now,
        updatedAt: now,
      }),
    )
  }
  await em.flush()

  return Response.json({ ok: true, recoveryCodes: plainCodes })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva MFA',
  summary: 'Activate TOTP enrollment',
  methods: {
    POST: {
      summary: 'Confirm a pending enrollment with a valid code',
      description: 'Returns 8 single-use recovery codes exactly once; previous batches are invalidated.',
      tags: ['Orva MFA'],
      requestBody: { schema: activateSchema },
      responses: [{ status: 200, description: 'Activated.', schema: responseSchema }],
      errors: [
        { status: 400, description: 'No pending enrollment or invalid code', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
