import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { BroadcastRecipient } from '../../../data/entities'
import { recipientsQuerySchema } from '../../../data/validators'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_marketing.view'] },
}

const recipientSchema = z.object({
  id: z.string(), customerEntityId: z.string(), displayName: z.string(), email: z.string(),
  status: z.string(), messageId: z.string().nullable(), error: z.string().nullable(), updatedAt: z.string(),
})

/** The send log of one broadcast: who got it, who did not, and why. */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = recipientsQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const rows = await withTenantRls(em, auth.tenantId, (tem) => tem.find(
    BroadcastRecipient,
    { tenantId: auth.tenantId, organizationId, broadcastId: parsed.data.broadcastId },
    { orderBy: { displayName: 'asc' } },
  ))
  return Response.json({
    items: rows.map((row) => ({
      id: row.id, customerEntityId: row.customerEntityId, displayName: row.displayName, email: row.email,
      status: row.status, messageId: row.messageId ?? null, error: row.error ?? null, updatedAt: row.updatedAt.toISOString(),
    })),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Marketing',
  summary: 'Broadcast recipients',
  methods: {
    GET: {
      summary: 'Per-recipient send log of one broadcast',
      tags: ['Orva Marketing'],
      query: recipientsQuerySchema,
      responses: [{ status: 200, description: 'Rows.', schema: z.object({ items: z.array(recipientSchema) }) }],
    },
  },
}
