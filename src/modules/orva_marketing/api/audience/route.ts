import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { audienceQuerySchema } from '../../data/validators'
import { filterContacts, loadContacts, pickRecipients } from '../../lib/audience'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_marketing.view'] },
}

const contactSchema = z.object({
  id: z.string(), kind: z.enum(['person', 'company']), displayName: z.string(), email: z.string().nullable(),
  consent: z.boolean(), consentAt: z.string().nullable(), consentSource: z.string().nullable(),
})
const responseSchema = z.object({
  counts: z.object({ total: z.number(), consented: z.number(), reachable: z.number(), noEmail: z.number(), notConsented: z.number() }),
  contacts: z.array(contactSchema),
})

/**
 * Every active contact with its consent, plus the numbers the composer shows:
 * how many will actually receive the next broadcast and why the rest will not.
 */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = audienceQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId }
  const contacts = await withTenantRls(em, scope.tenantId, (tem) => loadContacts(tem, scope))
  const { counts } = pickRecipients(contacts)
  return Response.json({ counts, contacts: filterContacts(contacts, parsed.data.search) })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Marketing',
  summary: 'Marketing audience',
  methods: {
    GET: {
      summary: 'Active contacts with marketing consent, and the reachable count for the next broadcast',
      tags: ['Orva Marketing'],
      query: audienceQuerySchema,
      responses: [{ status: 200, description: 'Counts and contacts.', schema: responseSchema }],
    },
  },
}
