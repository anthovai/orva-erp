import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { lotsQuerySchema } from '../../data/validators'
import { lotsOnHand } from '../../lib/internal'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_stock.view'] },
}

const lotSchema = z.object({
  lotId: z.string(), catalogVariantId: z.string(), variantName: z.string().nullable(), sku: z.string().nullable(),
  lotNumber: z.string().nullable(), expiresAt: z.string().nullable(), onHand: z.string(), unitCost: z.string().nullable(),
})

/** Lots with on-hand quantity and cost — the picker behind receive, retail sale and valuation. */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = lotsQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const scope = { tenantId: auth.tenantId, organizationId }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const rows = await withTenantRls(em, scope.tenantId, (tem) => lotsOnHand(tem, scope, { catalogVariantId: parsed.data.catalogVariantId, includeEmpty: parsed.data.all === '1' }))
  return Response.json({
    items: rows.map((r) => ({
      lotId: r.lot_id, catalogVariantId: r.catalog_variant_id, variantName: r.variant_name, sku: r.sku,
      lotNumber: r.lot_number, expiresAt: r.expires_at, onHand: Number(r.on_hand).toFixed(4), unitCost: r.unit_cost == null ? null : Number(r.unit_cost).toFixed(4),
    })),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Stock',
  summary: 'Lots on hand',
  methods: {
    GET: { summary: 'Lots with on-hand quantity, expiry and unit cost', tags: ['Orva Stock'], query: lotsQuerySchema, responses: [{ status: 200, description: 'Lots.', schema: z.object({ items: z.array(lotSchema) }) }] },
  },
}
