import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { purchasingSummary } from '../../lib/summary'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_purchasing.view'] },
}

const summarySchema = z.object({
  committedNotBilled: z.number(),
  lateCount: z.number(),
  lateLines: z.array(
    z.object({
      orderId: z.string(),
      poNumber: z.string().nullable(),
      lineId: z.string(),
      lineNo: z.number(),
      description: z.string(),
      vendorName: z.string(),
      unit: z.string().nullable(),
      orderedQty: z.number(),
      receivedQty: z.number(),
      remainingQty: z.number(),
      expectedOn: z.string(),
      daysLate: z.number(),
    }),
  ),
})

/**
 * The two purchasing facts worth reading without opening purchasing: money
 * promised and not yet billed, and goods promised and not yet here.
 *
 * The home screen reads the same numbers through optional DI rather than this
 * route, so it degrades to nothing when the module is absent. This exists for
 * purchasing's own screens and for anyone reading the API.
 */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const today = new Date().toISOString().slice(0, 10)
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const summary = await withTenantRls(em, auth.tenantId, (tem) =>
    purchasingSummary(tem, { tenantId: auth.tenantId as string, organizationId }, today),
  )
  return Response.json(summary)
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Purchasing',
  summary: 'Committed money and late deliveries',
  methods: {
    GET: {
      summary: 'Ex-VAT value of open orders not yet billed, and the ordered lines past their expected date',
      tags: ['Orva Purchasing'],
      responses: [{ status: 200, description: 'Summary.', schema: summarySchema }],
      errors: [{ status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) }],
    },
  },
}
