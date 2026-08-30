import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { TotpCredential } from '../../data/entities'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_mfa.self'] },
}

const responseSchema = z.object({
  enrolled: z.boolean(),
  pending: z.boolean(),
  activatedAt: z.string().nullable(),
})

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub || !auth.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const credential = await em.findOne(TotpCredential, {
    tenantId: auth.tenantId,
    userId: auth.sub,
    deletedAt: null,
  })
  return Response.json({
    enrolled: credential?.status === 'active',
    pending: credential?.status === 'pending',
    activatedAt: credential?.activatedAt ? credential.activatedAt.toISOString() : null,
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva MFA',
  summary: 'Own MFA status',
  methods: {
    GET: {
      summary: 'Whether the caller has TOTP enrolled or pending',
      tags: ['Orva MFA'],
      responses: [{ status: 200, description: 'Status.', schema: responseSchema }],
      errors: [{ status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) }],
    },
  },
}
