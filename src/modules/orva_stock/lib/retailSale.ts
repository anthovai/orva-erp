import type { EntityManager } from '@mikro-orm/postgresql'
import type { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { StockIssue } from '../data/entities'
import type { retailSaleSchema } from '../data/validators'
import { callInternal, lotsOnHand, resolveStockSite } from './internal'
import { splitVatInclusive } from './valuation'

export type RetailSaleInput = z.infer<typeof retailSaleSchema>
export type RetailSaleResult = {
  invoiceId: string
  invoiceNumber: string
  gross: number
  net: number
  vat: number
  accounting?: unknown
  documents: { abbreviatedTaxInvoice: string; receipt: string }
}
export type StockScope = { tenantId: string; organizationId: string }

const VAT_RATE = 7
const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * ขายปลีก (B2C) in one step, the way a lotion brand sells at a market, via
 * LINE, or on a marketplace: shelf prices include VAT, the customer may be
 * anonymous, payment arrives now. Creates the sales invoice in the brand's
 * number series (default MRV), records the payment (books: Dr bank / Cr AR,
 * output VAT via the finance bridge), issues stock from the chosen lots
 * through WMS, and queues COGS at each lot's cost.
 *
 * Shared by the ขายปลีก screen's route and the marketplace order import, so
 * an imported Shopee order is exactly the sale the counter would have made.
 * Runs inside a request (the other modules are called with the caller's
 * cookies); throws errors carrying `status` for the route to relay.
 */
export async function recordRetailSale(
  req: Request,
  em: EntityManager,
  scope: StockScope,
  userId: string,
  input: RetailSaleInput,
): Promise<RetailSaleResult> {
  const { organizationId } = scope

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
    const gross = r2(line.unitPriceGross * line.quantity)
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
        // WMS requires tenant and organization in the body (see receive).
        tenantId: scope.tenantId, organizationId,
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

  return {
    invoiceId,
    invoiceNumber: minted.number,
    gross: r2(totals.gross), net: r2(totals.net), vat: r2(totals.vat),
    accounting: payment.accounting,
    documents: {
      abbreviatedTaxInvoice: `/backend/documents/preview?type=abbreviated_tax_invoice&documentId=${invoiceId}`,
      receipt: `/backend/documents/preview?type=receipt&documentId=${invoiceId}`,
    },
  }
}
