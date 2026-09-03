import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { StockSettings } from '../../data/entities'
import { stockSettingsPutSchema } from '../../data/validators'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_stock.view'] },
  PUT: { requireAuth: true, requireFeatures: ['orva_stock.manage'] },
}

const responseSchema = z.object({
  inventoryAccountId: z.string().nullable(),
  cogsAccountId: z.string().nullable(),
  warehouseId: z.string().nullable(),
  locationId: z.string().nullable(),
  /** Convenience for the screens: the single warehouse/location when only one exists. */
  suggested: z.object({ warehouseId: z.string().nullable(), locationId: z.string().nullable() }),
})

const toJson = (s: StockSettings | null) => ({
  inventoryAccountId: s?.inventoryAccountId ?? null,
  cogsAccountId: s?.cogsAccountId ?? null,
  warehouseId: s?.warehouseId ?? null,
  locationId: s?.locationId ?? null,
})

/** Which ledger accounts stock posts to and which WMS warehouse/location receives it. */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const tenantId = auth.tenantId
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const result = await withTenantRls(em, tenantId, async (tem) => {
    const settings = await tem.findOne(StockSettings, { tenantId, organizationId })
    const warehouses = (await tem.execute(
      `select id from wms_warehouses where tenant_id = ?::uuid and organization_id = ?::uuid and deleted_at is null and is_active order by is_primary desc, created_at limit 2`,
      [tenantId, organizationId],
    )) as Array<{ id: string }>
    const warehouseId = settings?.warehouseId ?? (warehouses.length ? warehouses[0].id : null)
    const locations = warehouseId
      ? ((await tem.execute(
          `select id from wms_warehouse_locations where tenant_id = ?::uuid and warehouse_id = ?::uuid and deleted_at is null and is_active order by created_at limit 2`,
          [tenantId, warehouseId],
        )) as Array<{ id: string }>)
      : []
    return {
      ...toJson(settings),
      suggested: { warehouseId, locationId: settings?.locationId ?? (locations.length ? locations[0].id : null) },
    }
  })
  return Response.json(result)
}

export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = stockSettingsPutSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const tenantId = auth.tenantId
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const saved = await withTenantRls(em, tenantId, async (tem) => {
    const now = new Date()
    const row = (await tem.findOne(StockSettings, { tenantId, organizationId })) ?? tem.create(StockSettings, { tenantId, organizationId, createdAt: now, updatedAt: now })
    for (const key of ['inventoryAccountId', 'cogsAccountId', 'warehouseId', 'locationId'] as const) {
      if (parsed.data[key] !== undefined) row[key] = parsed.data[key] ?? null
    }
    row.updatedAt = now
    tem.persist(row)
    await tem.flush()
    return toJson(row)
  })
  return Response.json({ ...saved, suggested: { warehouseId: saved.warehouseId, locationId: saved.locationId } })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Stock',
  summary: 'Stock settings',
  methods: {
    GET: { summary: 'Inventory/COGS accounts and default warehouse/location', tags: ['Orva Stock'], responses: [{ status: 200, description: 'Settings.', schema: responseSchema }] },
    PUT: { summary: 'Update stock settings', tags: ['Orva Stock'], requestBody: { schema: stockSettingsPutSchema }, responses: [{ status: 200, description: 'Saved.', schema: responseSchema }] },
  },
}
