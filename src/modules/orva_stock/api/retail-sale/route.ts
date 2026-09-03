import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { StockIssue } from '../../data/entities'
import { retailSaleSchema } from '../../data/validators'
import { callInternal, lotsOnHand, resolveStockSite } from '../../lib/internal'
import { splitVatInclusive } from '../../lib/valuation'

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

const VAT_RATE = 7

/**
 * ขายปลีก (B2C) in one step, the way a lotion brand sells at a market or via
 * LINE: shelf prices include VAT, the customer may be anonymous, payment
 * arrives now. Creates the sales invoice in the brand's number series
 * (default MRV), records the payment (books: Dr bank / Cr AR, output VAT via
 * the finance bridge), issues stock from the chosen lots through WMS, and
 * queues COGS at each lot's cost. The printable ใบกำกับภาษีอย่างย่อ is ready
 * the moment this returns.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.sub) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = retailSaleSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const input = parsed.data
  const scope = { tenantId: auth.tenantId, organizationId }
  const userId = auth.sub
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    // 1) stock check + lot costs, before anything is written
    const plan = await withTenantRls(em, scope.tenantId, async (tem) => {
      const site = await resolveStockSite(tem, scope)
      const lots = await lotsOnHand(tem, scope)
      const picked = input.lines.map((line) => {
        const lot = lots.find((l) => l.lot_id === line.lotId && l.catalog_variant_id === line.catalogVariantId)
        if (!lot) throw Object.assign(new Error(`ไม่พบล็อตของ ${line.name}`), { status: 404 })
        if (Number(lot.on_hand) < line.quantity) throw Object.assign(new Error(`ล็อต ${lot.lot_number ?? ''} ของ ${line.name} คงเหลือ ${Number(lot.on_hand)} ไม่พอสำหรับ ${line.quantity}`), { status: 400 })
        return { line, lot }
      })
      return { site, picked }
    })

    // 2) invoice in the brand series, VAT split out of shelf prices
    const brand = input.brand ?? 'MRV'
    const minted = await callInternal<{ number?: string }>(req, '/api/sales/document-numbers', { kind: 'invoice', brand })
    if (!minted.number) throw Object.assign(new Error('ออกเลขที่ใบกำกับภาษีไม่ได้'), { status: 502 })
    const lines = input.lines.map((line, index) => {
      const gross = Math.round(line.unitPriceGross * line.quantity * 100) / 100
      const split = splitVatInclusive(gross, VAT_RATE)
      const unitNet = Math.round((line.unitPriceGross / (1 + VAT_RATE / 100)) * 10000) / 10000
      return {
        lineNumber: index + 1, kind: 'product', name: line.name, sku: line.sku ?? undefined,
        quantity: line.quantity, currencyCode: 'THB',
        unitPriceNet: unitNet, unitPriceGross: line.unitPriceGross,
        taxRate: VAT_RATE, taxAmount: split.vat, totalNetAmount: split.net, totalGrossAmount: split.gross,
        metadata: { catalogVariantId: line.catalogVariantId, lotId: line.lotId },
      }
    })
    const totals = lines.reduce((s, l) => ({ net: s.net + l.totalNetAmount, vat: s.vat + l.taxAmount, gross: s.gross + l.totalGrossAmount }), { net: 0, vat: 0, gross: 0 })
    const r2 = (n: number) => Math.round(n * 100) / 100
    const createdRaw = await callInternal<{ id?: string; invoiceId?: string }>(req, '/api/sales/invoices', {
      invoiceNumber: minted.number,
      issueDate: input.soldOn,
      dueDate: input.soldOn,
      currencyCode: 'THB',
      lines,
      subtotalNetAmount: r2(totals.net), subtotalGrossAmount: r2(totals.gross),
      discountTotalAmount: 0, taxTotalAmount: r2(totals.vat),
      grandTotalNetAmount: r2(totals.net), grandTotalGrossAmount: r2(totals.gross),
      metadata: {
        retail: true, brandCode: brand, paymentMethod: input.paymentMethod, reference: input.reference ?? null,
        customerSnapshot: { displayName: input.customerName?.trim() || 'ลูกค้าทั่วไป', phone: input.customerPhone ?? null },
        source: 'orva_stock.retail_sale',
      },
    })
    const invoiceId = createdRaw.invoiceId ?? createdRaw.id
    if (!invoiceId) throw Object.assign(new Error('สร้างใบกำกับภาษีไม่สำเร็จ'), { status: 502 })

    // 3) paid on the spot — the documents module updates the invoice and books it
    const ctx = await callInternal<{ updatedAt: string | null }>(req, `/api/orva_documents/record-payment?invoiceId=${invoiceId}`, null, 'GET')
    const payment = await callInternal<{ accounting?: unknown }>(req, '/api/orva_documents/record-payment', {
      invoiceId, paidDate: input.soldOn, amountReceived: r2(totals.gross), whtAmount: 0,
      note: [input.paymentMethod === 'cash' ? 'เงินสด' : input.paymentMethod === 'marketplace' ? 'มาร์เก็ตเพลส' : 'โอน', input.reference].filter(Boolean).join(' '),
      updatedAt: ctx.updatedAt,
    })

    // 4) stock out per lot through WMS, COGS queued at lot cost
    await withTenantRls(em, scope.tenantId, async (tem) => {
      const now = new Date()
      for (const { line, lot } of plan.picked) {
        const adjusted = await callInternal<{ ok: true; movementId?: string }>(req, '/api/wms/inventory/adjust', {
          warehouseId: plan.site.warehouseId, locationId: plan.site.locationId,
          catalogVariantId: line.catalogVariantId, lotId: line.lotId,
          delta: -line.quantity, reason: `ขายปลีก ${minted.number}`, reasonCode: 'sale',
          referenceType: 'so', referenceId: invoiceId, performedBy: userId,
          performedAt: new Date(`${input.soldOn}T00:00:00Z`).toISOString(),
          metadata: { source: 'orva_stock.retail_sale', invoiceId },
        })
        tem.persist(tem.create(StockIssue, {
          tenantId: scope.tenantId, organizationId, lotId: line.lotId, catalogVariantId: line.catalogVariantId,
          quantity: line.quantity.toFixed(4), unitCost: Number(lot.unit_cost ?? 0).toFixed(4), kind: 'sale',
          issuedOn: input.soldOn, invoiceId, movementId: adjusted.movementId ?? null, journalId: null,
          memo: `${minted.number} ${line.name}`, createdBy: userId, createdAt: now, updatedAt: now,
        }))
      }
      await tem.flush()
    })

    return Response.json({
      ok: true,
      invoiceId,
      invoiceNumber: minted.number,
      gross: r2(totals.gross), net: r2(totals.net), vat: r2(totals.vat),
      accounting: payment.accounting,
      documents: {
        abbreviatedTaxInvoice: `/backend/documents/preview?type=abbreviated_tax_invoice&documentId=${invoiceId}`,
        receipt: `/backend/documents/preview?type=receipt&documentId=${invoiceId}`,
      },
    })
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
