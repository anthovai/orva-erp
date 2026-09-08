import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { orderIdParamsSchema } from '../../../data/validators'
import { lineNet, lineVat, priceVariance, round2, type VatMode } from '../../../lib/totals'
import { remainingQty } from '../../../lib/status'
import { findOrphanReceipts, receivedByLine } from '../../../lib/receipts'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_purchasing.view'] },
}

const lineSchema = z.object({
  id: z.string(),
  lineNo: z.number(),
  kind: z.string(),
  catalogVariantId: z.string().nullable(),
  description: z.string(),
  sku: z.string().nullable(),
  quantity: z.number(),
  unit: z.string().nullable(),
  unitPrice: z.number(),
  vatMode: z.string(),
  accountId: z.string(),
  accountCode: z.string().nullable(),
  accountName: z.string().nullable(),
  expectedOn: z.string().nullable(),
  shortQty: z.number().nullable(),
  net: z.number(),
  vat: z.number(),
  receivedQty: z.number(),
  remainingQty: z.number(),
  billedAmount: z.number(),
  variance: z.number().nullable(),
  isLate: z.boolean(),
})

const detailSchema = z.object({
  order: z.object({
    id: z.string(),
    poNumber: z.string().nullable(),
    status: z.string(),
    vendorPartyId: z.string(),
    vendorName: z.string(),
    vendorEmail: z.string().nullable(),
    orderDate: z.string(),
    expectedOn: z.string().nullable(),
    currencyCode: z.string(),
    subtotal: z.number(),
    taxAmount: z.number(),
    totalAmount: z.number(),
    billedAmount: z.number(),
    memo: z.string().nullable(),
    vendorReference: z.string().nullable(),
    closeReason: z.string().nullable(),
    sentAt: z.string().nullable(),
    closedAt: z.string().nullable(),
    cancelledAt: z.string().nullable(),
    updatedAt: z.string(),
  }),
  lines: z.array(lineSchema),
  receipts: z.array(
    z.object({
      id: z.string(),
      lineId: z.string(),
      lineNo: z.number(),
      description: z.string(),
      quantity: z.number(),
      receivedOn: z.string(),
      lotNumber: z.string().nullable(),
      movementId: z.string().nullable(),
      unitCost: z.number().nullable(),
      memo: z.string().nullable(),
    }),
  ),
  unlinkedReceipts: z.number(),
})

type OrderRow = {
  id: string
  po_number: string | null
  status: string
  vendor_party_id: string
  vendor_name: string
  vendor_email: string | null
  order_date: string
  expected_on: string | null
  currency_code: string
  subtotal: string
  tax_amount: string
  total_amount: string
  memo: string | null
  vendor_reference: string | null
  close_reason: string | null
  sent_at: string | null
  closed_at: string | null
  cancelled_at: string | null
  updated_at: string
}

type ReceiptRow = {
  id: string
  order_line_id: string
  quantity: string
  received_on: string
  lot_number: string | null
  movement_id: string | null
  unit_cost: string | null
  memo: string | null
  line_no: number
  description: string
}

type LineRow = {
  id: string
  line_no: number
  kind: string
  catalog_variant_id: string | null
  description: string
  sku: string | null
  quantity: string
  unit: string | null
  unit_price: string
  vat_mode: string
  account_id: string
  account_code: string | null
  account_name: string | null
  expected_on: string | null
  short_qty: string | null
}

/**
 * One order with its lines, and the three numbers that make the page worth
 * opening: ordered, received and billed.
 *
 * Received comes from the receipt rows; billed is still zero until phase A3
 * adds the bill-link table. The response also reports how many WMS receipts
 * exist for this order with no receipt row here, so the page can offer the
 * repair instead of quietly under-reporting what arrived.
 *
 * `vendor_snapshot` is deliberately not selected: it is encrypted at rest, so
 * raw SQL would hand back ciphertext (see .ai/lessons.md). The live party
 * name is joined instead; the snapshot is read through the decrypting finder
 * only where the printed sheet needs it.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = orderIdParamsSchema.safeParse(await ctx.params)
  if (!parsed.success) return Response.json({ error: 'ไม่พบใบสั่งซื้อ' }, { status: 404 })
  const tenantId = auth.tenantId
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const payload = await withTenantRls(em, tenantId, async (tem) => {
    const [order] = (await tem.execute(
      `select o.id, o.po_number, o.status, o.vendor_party_id,
              coalesce(p.display_name, '—') as vendor_name, p.email as vendor_email,
              to_char(o.order_date, 'YYYY-MM-DD') as order_date,
              to_char(o.expected_on, 'YYYY-MM-DD') as expected_on,
              o.currency_code, o.subtotal::text as subtotal, o.tax_amount::text as tax_amount,
              o.total_amount::text as total_amount, o.memo, o.vendor_reference, o.close_reason,
              o.sent_at::text as sent_at, o.closed_at::text as closed_at, o.cancelled_at::text as cancelled_at,
              o.updated_at::text as updated_at
         from orva_purchasing_orders o
         left join orva_parties p on p.id = o.vendor_party_id and p.deleted_at is null
        where o.id = ?::uuid and o.tenant_id = ?::uuid and o.organization_id = ?::uuid and o.deleted_at is null`,
      [parsed.data.id, tenantId, organizationId],
    )) as OrderRow[]
    if (!order) return null
    const lines = (await tem.execute(
      `select l.id, l.line_no, l.kind, l.catalog_variant_id, l.description, l.sku,
              l.quantity::text as quantity, l.unit, l.unit_price::text as unit_price, l.vat_mode,
              l.account_id, a.code as account_code, a.name as account_name,
              to_char(l.expected_on, 'YYYY-MM-DD') as expected_on,
              l.short_qty::text as short_qty
         from orva_purchasing_order_lines l
         left join orva_gl_accounts a on a.id = l.account_id and a.tenant_id = l.tenant_id and a.organization_id = l.organization_id
        where l.order_id = ?::uuid and l.tenant_id = ?::uuid and l.deleted_at is null
        order by l.line_no`,
      [parsed.data.id, tenantId],
    )) as LineRow[]
    const receipts = (await tem.execute(
      `select r.id, r.order_line_id, r.quantity::text as quantity,
              to_char(r.received_on, 'YYYY-MM-DD') as received_on,
              r.lot_number, r.movement_id, r.unit_cost::text as unit_cost, r.memo,
              l.line_no, l.description
         from orva_purchasing_receipts r
         join orva_purchasing_order_lines l on l.id = r.order_line_id
        where r.order_id = ?::uuid and r.tenant_id = ?::uuid and r.deleted_at is null
        order by r.received_on, r.created_at`,
      [parsed.data.id, tenantId],
    )) as ReceiptRow[]
    const received = await receivedByLine(tem, { tenantId, organizationId }, parsed.data.id)
    const orphans = await findOrphanReceipts(tem, { tenantId, organizationId }, { orderId: parsed.data.id })
    return { order, lines, receipts, received, orphanCount: orphans.length }
  })

  if (!payload) return Response.json({ error: 'ไม่พบใบสั่งซื้อ' }, { status: 404 })

  const today = new Date().toISOString().slice(0, 10)
  const chasing = payload.order.status === 'sent' || payload.order.status === 'partially_received'
  const lines = payload.lines.map((row) => {
    const quantity = Number(row.quantity)
    const unitPrice = Number(row.unit_price)
    const vatMode = (row.vat_mode === 'none' ? 'none' : '7') as VatMode
    const net = lineNet({ quantity, unitPrice, vatMode })
    const receivedQty = payload.received.get(row.id) ?? 0
    // A3 replaces this with the bill-link sum.
    const billedAmount = 0
    return {
      id: row.id,
      lineNo: row.line_no,
      kind: row.kind,
      catalogVariantId: row.catalog_variant_id,
      description: row.description,
      sku: row.sku,
      quantity,
      unit: row.unit,
      unitPrice,
      vatMode: row.vat_mode,
      accountId: row.account_id,
      accountCode: row.account_code,
      accountName: row.account_name,
      expectedOn: row.expected_on,
      shortQty: row.short_qty == null ? null : Number(row.short_qty),
      net,
      vat: lineVat({ quantity, unitPrice, vatMode }),
      receivedQty,
      remainingQty: remainingQty({ ordered: quantity, received: receivedQty }),
      billedAmount,
      variance: priceVariance({ billedAmount, orderedNet: net }),
      isLate: chasing && row.expected_on != null && row.expected_on < today && receivedQty < quantity,
    }
  })

  return Response.json({
    order: {
      id: payload.order.id,
      poNumber: payload.order.po_number,
      status: payload.order.status,
      vendorPartyId: payload.order.vendor_party_id,
      vendorName: payload.order.vendor_name,
      vendorEmail: payload.order.vendor_email,
      orderDate: payload.order.order_date,
      expectedOn: payload.order.expected_on,
      currencyCode: payload.order.currency_code,
      subtotal: Number(payload.order.subtotal),
      taxAmount: Number(payload.order.tax_amount),
      totalAmount: Number(payload.order.total_amount),
      billedAmount: round2(lines.reduce((sum, line) => sum + line.billedAmount, 0)),
      memo: payload.order.memo,
      vendorReference: payload.order.vendor_reference,
      closeReason: payload.order.close_reason,
      sentAt: payload.order.sent_at,
      closedAt: payload.order.closed_at,
      cancelledAt: payload.order.cancelled_at,
      updatedAt: payload.order.updated_at,
    },
    lines,
    receipts: payload.receipts.map((row) => ({
      id: row.id,
      lineId: row.order_line_id,
      lineNo: row.line_no,
      description: row.description,
      quantity: Number(row.quantity),
      receivedOn: row.received_on,
      lotNumber: row.lot_number,
      movementId: row.movement_id,
      unitCost: row.unit_cost == null ? null : Number(row.unit_cost),
      memo: row.memo,
    })),
    /** WMS receipts for this order with no row here — offer the repair. */
    unlinkedReceipts: payload.orphanCount,
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Purchasing',
  summary: 'One purchase order',
  methods: {
    GET: {
      summary: 'Order header and lines with ordered, received, billed and the price variance',
      tags: ['Orva Purchasing'],
      responses: [{ status: 200, description: 'Order.', schema: detailSchema }],
      errors: [{ status: 404, description: 'No such order in this scope', schema: z.object({ error: z.string() }) }],
    },
  },
}
