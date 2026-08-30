import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { RecoveryCode } from '../../data/entities'
import { disableSchema } from '../../data/validators'
import { findActiveCredential, verifyChallengeCode } from '../../lib/service'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['orva_mfa.self'] },
}

const responseSchema = z.object({ ok: z.boolean() })

/** Disables MFA after proving possession (TOTP or an unused recovery code). */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = disableSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const credential = await findActiveCredential(em, auth.tenantId, auth.sub)
  if (!credential) return Response.json({ error: 'MFA is not active' }, { status: 400 })

  const result = await verifyChallengeCode(em, credential, parsed.data.code)
  if (!result.ok) {
    if (result.reason === 'locked') {
      return Response.json({ error: 'Too many attempts — try again later', retryAfterSeconds: result.retryAfterSeconds }, { status: 423 })
    }
    return Response.json({ error: 'Invalid code' }, { status: 400 })
  }

  const now = new Date()
  credential.deletedAt = now
  const codes = await em.find(RecoveryCode, { tenantId: auth.tenantId, userId: auth.sub, deletedAt: null })
  codes.forEach((code) => { code.deletedAt = now })
  await em.flush()

  return Response.json({ ok: true })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva MFA',
  summary: 'Disable own MFA',
  methods: {
    POST: {
      summary: 'Disable TOTP after verifying a code',
      tags: ['Orva MFA'],
      requestBody: { schema: disableSchema },
      responses: [{ status: 200, description: 'Disabled.', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Not active or invalid code', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) },
        { status: 423, description: 'Locked out after repeated failures', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
