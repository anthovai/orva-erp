import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { TotpCredential } from '../../data/entities'
import { buildOtpauthUrl, generateTotpSecret } from '../../lib/totp'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['orva_mfa.self'] },
}

const responseSchema = z.object({ secret: z.string(), otpauthUrl: z.string() })

/**
 * Starts (or restarts) enrollment: creates a pending credential and returns
 * the secret exactly once. An active credential must be disabled first.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const existing = await em.findOne(TotpCredential, {
    tenantId: auth.tenantId,
    userId: auth.sub,
    deletedAt: null,
  })
  if (existing?.status === 'active') {
    return Response.json({ error: 'MFA is already active — disable it before re-enrolling' }, { status: 409 })
  }

  const secret = generateTotpSecret()
  const now = new Date()
  if (existing) {
    existing.secret = secret
    existing.lastUsedStep = null
    existing.failedAttempts = 0
    existing.lockedUntil = null
  } else {
    em.persist(
      em.create(TotpCredential, {
        tenantId: auth.tenantId,
        organizationId,
        userId: auth.sub,
        secret,
        status: 'pending',
        failedAttempts: 0,
        createdAt: now,
        updatedAt: now,
      }),
    )
  }
  await em.flush()

  return Response.json({
    secret,
    otpauthUrl: buildOtpauthUrl(secret, auth.email ?? auth.sub),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva MFA',
  summary: 'Start TOTP enrollment',
  methods: {
    POST: {
      summary: 'Create a pending TOTP credential and return the secret once',
      description: 'Re-invoking replaces a pending secret. 409 when an active credential exists.',
      tags: ['Orva MFA'],
      responses: [{ status: 200, description: 'Secret + otpauth URI (shown once).', schema: responseSchema }],
      errors: [
        { status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) },
        { status: 409, description: 'Already active', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
