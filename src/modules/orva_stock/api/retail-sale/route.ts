import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { retailSaleSchema } from '../../data/validators'
import { recordRetailSale } from '../../lib/retailSale'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['orva_stock.manage', 'sales.invoices.manage', 'wms.adjust_inventory'] },
}

const resultSchema = z.object({
  ok: z.literal(true),
  invoiceId: z.string(),
  invoiceNumber: z.string(),
  gross: z.number(),
  net: z.number(),
  vat: z.number(),
  accounting: z.unknown().optional(),
  documents: z.object({ abbreviatedTaxInvoice: z.string(), receipt: z.string() }),
})

/**
 * ขายปลีก (B2C) in one step — see `lib/retailSale.ts`, which the marketplace
 * order import shares so an imported order is the same sale the counter makes.
 * The printable ใบกำกับภาษีอย่างย่อ is ready the moment this returns.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.sub) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = retailSaleSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const sale = await recordRetailSale(req, em, { tenantId: auth.tenantId, organizationId }, auth.sub, parsed.data)
    return Response.json({ ok: true, ...sale })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json({ error: error instanceof Error ? error.message : 'Retail sale failed' }, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Stock',
  summary: 'Retail sale',
  methods: {
    POST: {
      summary: 'Record a B2C sale: brand-series invoice, payment, stock issue from lots, COGS queued',
      tags: ['Orva Stock'],
      requestBody: { schema: retailSaleSchema },
      responses: [{ status: 200, description: 'Sale recorded.', schema: resultSchema }],
      errors: [
        { status: 400, description: 'Invalid payload or insufficient stock', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
