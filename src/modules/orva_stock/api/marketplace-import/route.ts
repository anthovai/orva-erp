import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { MarketplaceImport } from '../../data/entities'
import { marketplaceHistoryQuerySchema, marketplaceImportSchema } from '../../data/validators'
import type { NormalizedOrder } from '../../lib/marketplaceFile'
import { resolveOrders } from '../../lib/marketplaceResolve'
import { recordRetailSale } from '../../lib/retailSale'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_stock.view'] },
  POST: { requireAuth: true, requireFeatures: ['orva_stock.manage', 'sales.invoices.manage', 'wms.adjust_inventory'] },
}

const resultSchema = z.object({
  externalOrderId: z.string(),
  status: z.enum(['imported', 'skipped', 'failed']),
  invoiceId: z.string().optional(),
  invoiceNumber: z.string().optional(),
  gross: z.number().optional(),
  message: z.string().optional(),
})
const historyRowSchema = z.object({
  id: z.string(), marketplace: z.string(), externalOrderId: z.string(), status: z.string(),
  invoiceId: z.string().nullable(), invoiceNumber: z.string().nullable(), orderDate: z.string().nullable(),
  buyerName: z.string().nullable(), gross: z.string().nullable(), message: z.string().nullable(), createdAt: z.string(),
})

/** What the import has done before — the latest first. */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = marketplaceHistoryQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const rows = await withTenantRls(em, auth.tenantId, (tem) => tem.find(
    MarketplaceImport,
    { tenantId: auth.tenantId, organizationId, ...(parsed.data.marketplace ? { marketplace: parsed.data.marketplace } : {}) },
    { orderBy: { createdAt: 'desc' }, limit: parsed.data.pageSize },
  ))
  return Response.json({
    items: rows.map((row) => ({
      id: row.id, marketplace: row.marketplace, externalOrderId: row.externalOrderId, status: row.status,
      invoiceId: row.invoiceId ?? null, invoiceNumber: row.invoiceNumber ?? null, orderDate: row.orderDate ?? null,
      buyerName: row.buyerName ?? null, gross: row.gross ?? null, message: row.message ?? null, createdAt: row.createdAt.toISOString(),
    })),
  })
}

/**
 * Turns the previewed orders into retail sales — one per order, exactly the
 * sale the ขายปลีก counter makes (brand-series invoice, payment as
 * "มาร์เก็ตเพลส" with the order id as reference, stock issued from lots FEFO,
 * COGS queued). Orders are resolved again here because stock moves between
 * preview and import; an order already imported is skipped, one that fails is
 * recorded with its reason and can be retried after the cause is fixed.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.sub) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = marketplaceImportSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const input = parsed.data
  const scope = { tenantId: auth.tenantId, organizationId }
  const userId = auth.sub
  const today = new Date().toISOString().slice(0, 10)
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const normalized: NormalizedOrder[] = input.orders.map((order) => ({
    externalOrderId: order.externalOrderId,
    orderDate: order.orderDate ?? null,
    status: null,
    buyerName: order.buyerName ?? null,
    lines: order.lines.map((line) => ({ sku: line.sku, productName: line.productName ?? null, quantity: line.quantity, unitPrice: line.unitPrice })),
    skipReason: null,
  }))
  let resolved
  try {
    resolved = await withTenantRls(em, scope.tenantId, (tem) => resolveOrders(tem, scope, input.marketplace, normalized))
  } catch (error) {
    return Response.json({ error: `ตรวจสอบออเดอร์กับสต็อกไม่สำเร็จ: ${error instanceof Error ? error.message : String(error)}` }, { status: 500 })
  }

  const results: Array<z.infer<typeof resultSchema>> = []
  for (const order of resolved) {
    if (order.resolution === 'imported') { results.push({ externalOrderId: order.externalOrderId, status: 'skipped', message: order.reason ?? undefined }); continue }
    if (order.resolution === 'skipped') { results.push({ externalOrderId: order.externalOrderId, status: 'skipped', message: order.reason ?? undefined }); continue }
    const soldOn = order.orderDate ?? today
    try {
      const sale = await recordRetailSale(req, em, scope, userId, {
        brand: input.brand,
        soldOn,
        paymentMethod: 'marketplace',
        reference: `${input.marketplace} ${order.externalOrderId}`.slice(0, 120),
        customerName: order.buyerName,
        customerPhone: null,
        lines: order.resolved.flatMap((line) => line.lots.map((lot) => ({
          catalogVariantId: line.catalogVariantId, lotId: lot.lotId, name: line.name, sku: line.sku,
          quantity: lot.quantity, unitPriceGross: line.unitPriceGross,
        }))),
      })
      await withTenantRls(em, scope.tenantId, async (tem) => {
        tem.persist(tem.create(MarketplaceImport, {
          tenantId: scope.tenantId, organizationId, marketplace: input.marketplace, externalOrderId: order.externalOrderId,
          status: 'imported', invoiceId: sale.invoiceId, invoiceNumber: sale.invoiceNumber, orderDate: soldOn,
          buyerName: order.buyerName, gross: sale.gross.toFixed(2), message: null, createdBy: userId, createdAt: new Date(), updatedAt: new Date(),
        }))
        await tem.flush()
      })
      results.push({ externalOrderId: order.externalOrderId, status: 'imported', invoiceId: sale.invoiceId, invoiceNumber: sale.invoiceNumber, gross: sale.gross })
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000)
      await withTenantRls(em, scope.tenantId, async (tem) => {
        tem.persist(tem.create(MarketplaceImport, {
          tenantId: scope.tenantId, organizationId, marketplace: input.marketplace, externalOrderId: order.externalOrderId,
          status: 'failed', invoiceId: null, invoiceNumber: null, orderDate: soldOn, buyerName: order.buyerName,
          gross: order.gross.toFixed(2), message, createdBy: userId, createdAt: new Date(), updatedAt: new Date(),
        }))
        await tem.flush()
      })
      results.push({ externalOrderId: order.externalOrderId, status: 'failed', message })
    }
  }

  const summary = results.reduce(
    (acc, r) => ({ imported: acc.imported + (r.status === 'imported' ? 1 : 0), skipped: acc.skipped + (r.status === 'skipped' ? 1 : 0), failed: acc.failed + (r.status === 'failed' ? 1 : 0), gross: acc.gross + (r.gross ?? 0) }),
    { imported: 0, skipped: 0, failed: 0, gross: 0 },
  )
  return Response.json({ ok: true, results, summary: { ...summary, gross: Math.round(summary.gross * 100) / 100 } })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Stock',
  summary: 'Marketplace order import',
  methods: {
    GET: { summary: 'Import history (latest first)', tags: ['Orva Stock'], query: marketplaceHistoryQuerySchema, responses: [{ status: 200, description: 'Rows.', schema: z.object({ items: z.array(historyRowSchema) }) }] },
    POST: {
      summary: 'Import previewed marketplace orders as retail sales, one invoice per order, skipping orders already imported',
      tags: ['Orva Stock'],
      requestBody: { schema: marketplaceImportSchema },
      responses: [{ status: 200, description: 'Per-order results.', schema: z.object({ ok: z.boolean(), results: z.array(resultSchema), summary: z.object({ imported: z.number(), skipped: z.number(), failed: z.number(), gross: z.number() }) }) }],
    },
  },
}
