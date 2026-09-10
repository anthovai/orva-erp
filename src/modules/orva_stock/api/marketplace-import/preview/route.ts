import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { MARKETPLACES, normalizeOrders, parseTable, suggestMapping, type Mapping, type MappingField, type Marketplace } from '../../../lib/marketplaceFile'
import { resolveOrders } from '../../../lib/marketplaceResolve'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['orva_stock.view'] },
}

const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_ROWS = 5000
const MAPPING_FIELDS: MappingField[] = ['orderId', 'sku', 'quantity', 'unitPrice', 'orderDate', 'status', 'buyerName', 'productName']

const previewResponseSchema = z.object({
  headers: z.array(z.string()),
  mapping: z.record(z.string(), z.string()),
  rowCount: z.number(),
  problems: z.array(z.string()),
  summary: z.object({ ready: z.number(), imported: z.number(), skipped: z.number(), gross: z.number() }),
  orders: z.array(z.object({
    externalOrderId: z.string(), orderDate: z.string().nullable(), status: z.string().nullable(), buyerName: z.string().nullable(),
    resolution: z.enum(['ready', 'imported', 'skipped']), reason: z.string().nullable(), gross: z.number(),
    lines: z.array(z.object({ sku: z.string(), productName: z.string().nullable(), quantity: z.number(), unitPrice: z.number() })),
    lots: z.array(z.object({ sku: z.string(), lotNumber: z.string().nullable(), quantity: z.number() })),
  })),
})

/**
 * Reads a marketplace order export (CSV or .xlsx) and shows what the import
 * would do — the columns it recognised, every order with its lines, which
 * ones are ready, which were already imported, which need a look and why —
 * without writing anything. The mapping can be corrected and posted again.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()

  let form: FormData
  try { form = await req.formData() } catch { return Response.json({ error: 'ต้องส่งเป็น multipart/form-data พร้อมไฟล์' }, { status: 400 }) }
  const file = form.get('file')
  if (!(file instanceof File)) return Response.json({ error: 'ไม่พบไฟล์ที่อัปโหลด' }, { status: 400 })
  if (file.size > MAX_FILE_BYTES) return Response.json({ error: 'ไฟล์ใหญ่เกิน 8 MB' }, { status: 400 })
  const marketplaceRaw = String(form.get('marketplace') ?? 'custom')
  if (!(MARKETPLACES as readonly string[]).includes(marketplaceRaw)) return Response.json({ error: 'marketplace ไม่ถูกต้อง' }, { status: 400 })
  const marketplace = marketplaceRaw as Marketplace
  const priceIsLineTotal = String(form.get('priceIsLineTotal') ?? '') === '1'
  let provided: Mapping = {}
  const mappingRaw = form.get('mapping')
  if (typeof mappingRaw === 'string' && mappingRaw.trim()) {
    try {
      const parsed = JSON.parse(mappingRaw) as Record<string, unknown>
      for (const field of MAPPING_FIELDS) {
        const value = parsed[field]
        if (typeof value === 'string' && value.trim()) provided[field] = value
      }
    } catch { return Response.json({ error: 'mapping ต้องเป็น JSON' }, { status: 400 }) }
  }

  let table
  try {
    table = parseTable(Buffer.from(await file.arrayBuffer()), file.name)
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'อ่านไฟล์ไม่ได้' }, { status: 400 })
  }
  if (table.rows.length > MAX_ROWS) return Response.json({ error: `ไฟล์มี ${table.rows.length} แถว — ตัวนำเข้ารับได้ครั้งละ ${MAX_ROWS} แถว` }, { status: 400 })

  // The user's choices win over the preset's guess, column by column.
  const mapping: Mapping = { ...suggestMapping(table.headers, marketplace), ...provided }
  for (const field of MAPPING_FIELDS) if (mapping[field] && !table.headers.includes(mapping[field]!)) delete mapping[field]
  const { orders, problems } = normalizeOrders(table, mapping, { priceIsLineTotal })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId }
  // An unexpected failure here must say what it was: a production build turns
  // an uncaught throw into an empty 500, which no one can act on.
  let resolved
  try {
    resolved = await withTenantRls(em, scope.tenantId, (tem) => resolveOrders(tem, scope, marketplace, orders))
  } catch (error) {
    return Response.json({ error: `ตรวจสอบออเดอร์กับสต็อกไม่สำเร็จ: ${error instanceof Error ? error.message : String(error)}` }, { status: 500 })
  }

  const summary = resolved.reduce(
    (acc, order) => ({
      ready: acc.ready + (order.resolution === 'ready' ? 1 : 0),
      imported: acc.imported + (order.resolution === 'imported' ? 1 : 0),
      skipped: acc.skipped + (order.resolution === 'skipped' ? 1 : 0),
      gross: acc.gross + (order.resolution === 'ready' ? order.gross : 0),
    }),
    { ready: 0, imported: 0, skipped: 0, gross: 0 },
  )
  return Response.json({
    headers: table.headers,
    mapping,
    rowCount: table.rows.length,
    problems,
    summary: { ...summary, gross: Math.round(summary.gross * 100) / 100 },
    orders: resolved.map((order) => ({
      externalOrderId: order.externalOrderId, orderDate: order.orderDate, status: order.status, buyerName: order.buyerName,
      resolution: order.resolution, reason: order.reason, gross: order.gross,
      lines: order.lines,
      lots: order.resolved.flatMap((line) => line.lots.map((lot) => ({ sku: line.sku, lotNumber: lot.lotNumber, quantity: lot.quantity }))),
    })),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Stock',
  summary: 'Marketplace order import — preview',
  methods: {
    POST: {
      summary: 'Parse a Shopee / Lazada / TikTok order export (CSV or .xlsx, multipart) and show what the import would do',
      tags: ['Orva Stock'],
      responses: [{ status: 200, description: 'Preview.', schema: previewResponseSchema }],
      errors: [{ status: 400, description: 'Unreadable file or mapping', schema: z.object({ error: z.string() }) }],
    },
  },
}
