import type { EntityManager } from '@mikro-orm/postgresql'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { consentSchema } from '../../data/validators'
import { setConsent } from '../../lib/consent'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['orva_marketing.manage'] },
}

/**
 * The owner records a yes or a no for one contact from the marketing screen —
 * "he said yes on the phone", "she asked us to stop". Writes the same custom
 * fields the CRM form edits, so both screens agree.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = consentSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const input = parsed.data
  const scope = { tenantId: auth.tenantId, organizationId }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  // The contact must be ours before anything is written against its id.
  const owned = await withTenantRls(em, scope.tenantId, (tem) =>
    tem.count(CustomerEntity, { id: input.customerEntityId, tenantId: scope.tenantId, organizationId, deletedAt: null }))
  if (!owned) return Response.json({ error: 'Contact not found' }, { status: 404 })

  const dataEngine = container.resolve<DataEngine>('dataEngine')
  await setConsent(dataEngine, scope, input.customerEntityId, input.consent, input.source ?? 'staff')
  return Response.json({ ok: true, consent: input.consent })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Marketing',
  summary: 'Marketing consent',
  methods: {
    POST: {
      summary: 'Record or withdraw marketing consent for one contact (writes the CRM custom fields)',
      tags: ['Orva Marketing'],
      requestBody: { schema: consentSchema },
      responses: [{ status: 200, description: 'Saved.', schema: z.object({ ok: z.boolean(), consent: z.boolean() }) }],
    },
  },
}
