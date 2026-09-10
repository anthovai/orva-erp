import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { valuationQuerySchema } from '../../data/validators'
import { lotsOnHand } from '../../lib/internal'
import { lowStockVariants } from '../../lib/lowStock'
import { buildValuation } from '../../lib/valuation'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_stock.view'] },
}

const lineSchema = z.object({
  lotId: z.string(), variantId: z.string(), variantName: z.string().nullable(), sku: z.string().nullable(), lotNumber: z.string().nullable(),
  expiresAt: z.string().nullable(), onHand: z.number(), unitCost: z.number().nullable(), value: z.number(),
  daysToExpiry: z.number().nullable(), expiryState: z.enum(['ok', 'soon', 'expired', 'unknown']),
})
const lowStockSchema = z.object({ variantId: z.string(), productId: z.string(), name: z.string(), sku: z.string().nullable(), onHand: z.number(), reorderPoint: z.number() })
const responseSchema = z.object({
  asOf: z.string(), lines: z.array(lineSchema), totalOnHand: z.number(), totalValue: z.number(),
  uncosted: z.number(), expiringSoon: z.number(), expired: z.number(),
  unpostedCogs: z.object({ count: z.number(), total: z.string() }),
  /** Variants at or below their product's reorder point — the ones to order now. */
  lowStock: z.array(lowStockSchema),
})

/** มูลค่าสินค้าคงเหลือ: on-hand per lot × that lot's cost, with expiry flags and the COGS still waiting to be posted. */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = valuationQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const asOf = parsed.data.asOf ?? new Date().toISOString().slice(0, 10)
  const scope = { tenantId: auth.tenantId, organizationId }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const result = await withTenantRls(em, scope.tenantId, async (tem) => {
    const rows = await lotsOnHand(tem, scope)
    const valuation = buildValuation(asOf, rows.map((r) => ({
      lotId: r.lot_id, variantId: r.catalog_variant_id, variantName: r.variant_name, sku: r.sku, lotNumber: r.lot_number,
      expiresAt: r.expires_at, onHand: Number(r.on_hand), unitCost: r.unit_cost == null ? null : Number(r.unit_cost),
    })))
    const [pending] = (await tem.execute(
      `select count(*)::int as n, coalesce(sum(quantity * unit_cost), 0)::text as total from orva_stock_issues
       where tenant_id = ?::uuid and organization_id = ?::uuid and deleted_at is null and journal_id is null`,
      [scope.tenantId, organizationId],
    )) as Array<{ n: number; total: string }>
    const lowStock = await lowStockVariants(tem, scope)
    return { ...valuation, unpostedCogs: { count: pending?.n ?? 0, total: Number(pending?.total ?? 0).toFixed(2) }, lowStock }
  })
  return Response.json(result)
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Stock',
  summary: 'Stock valuation',
  methods: {
    GET: { summary: 'On-hand value per lot with expiry flags', tags: ['Orva Stock'], query: valuationQuerySchema, responses: [{ status: 200, description: 'Valuation.', schema: responseSchema }] },
  },
}
