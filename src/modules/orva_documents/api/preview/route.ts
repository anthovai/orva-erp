import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import {
  resolveActiveOrganizationId,
  organizationScopeRequiredResponse,
} from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { previewQuerySchema } from '../../data/validators'
import { buildPrintableDocument, type TemplateId } from '../../lib/document'
import { resolveStockLabelSource } from '../../lib/stockBridge'
import { resolvePurchasingDocumentSource } from '../../lib/purchasingBridge'
import {
  documentFromLot,
  documentFromPayroll,
  documentFromQuote,
  findCreditMemoById,
  findInvoiceById,
  findPayrollLineById,
  findQuoteById,
  listInvoiceSources,
  listQuoteSources,
  loadSettings,
  sampleDocumentForBrand,
  sellerFrom,
  sourceOption,
  templateFor,
} from '../../lib/source'

const logger = createLogger('orva_documents').child({ component: 'preview' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_documents.view'] },
}

const sourceOptionSchema = z.object({
  id: z.string(),
  kind: z.string(),
  number: z.string(),
  issueDate: z.string().nullable(),
  customerName: z.string().nullable(),
})

const responseSchema = z.object({
  document: z.record(z.string(), z.unknown()),
  sources: z.array(sourceOptionSchema),
  usedSample: z.boolean(),
  /** 'quote' | 'invoice' | 'sample' — the UI narrows type choices by this. */
  sourceKind: z.string(),
})

/**
 * Renders any Thai document type from a sales quote. The same record can be
 * issued as a quotation, an invoice, a tax invoice or a receipt — that is how
 * Thai practice works, the heading and statutory block change, the figures do
 * not. Falls back to sample data so the screen is useful on an empty tenant.
 */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const url = new URL(req.url)
  const parsed = previewQuerySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const { type, documentId, brand, asOf, copies } = parsed.data
  const template = parsed.data.template as TemplateId | undefined

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const tenantId = auth.tenantId

  try {
    // Quote reads run OUTSIDE withTenantRls, mirroring the sales module's own
    // routes: the encryption subscriber does not decrypt inside our RLS
    // transaction (empirically — the same read decrypts on a plain fork and
    // returns ciphertext inside the transaction), and a sheet printing
    // ciphertext is worse than app-level scoping. Every query still filters
    // by tenantId explicitly, exactly as sales' public route does.
    const forked = em.fork()

    // ใบสั่งซื้อ: the record lives in orva_purchasing, which this module must
    // not import, so it arrives through the optional DI reader. Handled before
    // the sales lookups because a PO id is not a sales id and the checks below
    // are about which sales record prints as which sales document. Without the
    // purchasing module registered the type reports itself unavailable rather
    // than failing the whole screen.
    // The lot label: the lot lives in WMS and its cost in orva_stock, which
    // this module must not import, so it arrives through stock's optional DI
    // reader — the same seam as the purchase order. Without a documentId the
    // sample sheet renders below like any other type.
    if (type === 'lot_label' && documentId) {
      const stock = resolveStockLabelSource(container)
      if (!stock) {
        return Response.json({ error: 'โมดูลคลังสินค้าไม่พร้อมใช้งาน' }, { status: 400 })
      }
      const lotDocument = await withTenantRls(em, tenantId, async (tem) => {
        const data = await stock.findLot(tem, { tenantId, organizationId }, documentId)
        if (!data) return null
        const settings = await loadSettings(tem, { tenantId, organizationId })
        return documentFromLot(tem, { data, settings, copies, template })
      })
      if (!lotDocument) return Response.json({ error: 'ไม่พบล็อตนี้' }, { status: 404 })
      return Response.json({ document: lotDocument, usedSample: false, sourceKind: 'lot', sources: [] })
    }
    if (type === 'purchase_order' && documentId) {
      const purchasing = resolvePurchasingDocumentSource(container)
      if (!purchasing) {
        return Response.json({ error: 'โมดูลจัดซื้อไม่พร้อมใช้งาน' }, { status: 400 })
      }
      const order = await purchasing.findOrder(forked, { tenantId, organizationId }, documentId)
      if (!order) return Response.json({ error: 'ไม่พบใบสั่งซื้อ' }, { status: 404 })
      const purchaseOrderDocument = await withTenantRls(em, tenantId, async (tem) => {
        const settings = await loadSettings(tem, { tenantId, organizationId })
        return buildPrintableDocument({
          type,
          template: template ?? templateFor(type, settings),
          // We are the issuer of a purchase order; the vendor receives it.
          seller: sellerFrom(settings),
          buyer: order.counterparty,
          source: order.source,
          accentColor: settings?.brandColor ?? null,
          logoHeader: settings?.logoHeader ?? null,
          logoFooter: settings?.logoFooter ?? null,
          // Our payment block and sales terms belong on documents we are paid
          // on, not on one we are about to pay.
          paymentDetails: null,
          terms: null,
        })
      })
      return Response.json({
        document: purchaseOrderDocument,
        usedSample: false,
        sourceKind: 'purchase_order',
        sources: [],
      })
    }
    // both record kinds appear in the picker, newest first — a lone quote
    // list left the picker BLANK whenever an invoice was open
    const [quoteSources, invoiceSources] = await Promise.all([
      listQuoteSources(forked, { tenantId, organizationId }),
      listInvoiceSources(forked, { tenantId, organizationId }),
    ])
    const sourceRows = [...quoteSources, ...invoiceSources].sort((a, b) =>
      String(b.issue_date ?? '').localeCompare(String(a.issue_date ?? '')))
    // documentId may name a quote or an issued invoice — try in that order
    const row = documentId
      ? (await findQuoteById(forked, { quoteId: documentId, tenantId }))
        ?? (await findInvoiceById(forked, { invoiceId: documentId, tenantId }))
        ?? (await findCreditMemoById(forked, { creditMemoId: documentId, tenantId }))
        ?? (await findPayrollLineById(forked, { payrollLineId: documentId, tenantId }))
      : null
    if (row?.kind === 'payroll_line' && type !== 'payslip') {
      return Response.json({ error: 'A payroll line prints only as สลิปเงินเดือน' }, { status: 400 })
    }
    if (type === 'payslip' && row && row.kind !== 'payroll_line') {
      return Response.json({ error: 'สลิปเงินเดือน prints from a payroll line' }, { status: 400 })
    }
    // a credit/debit note record prints only its own sheet; a note type needs a note record
    const noteTypes: string[] = ['credit_note', 'debit_note']
    if (row?.kind === 'credit_memo' && !noteTypes.includes(type)) {
      return Response.json({ error: 'A credit/debit note record prints only as ใบลดหนี้/ใบเพิ่มหนี้' }, { status: 400 })
    }
    if (row && row.kind !== 'credit_memo' && noteTypes.includes(type)) {
      return Response.json({ error: 'ใบลดหนี้/ใบเพิ่มหนี้ prints from a note record — ออกใบลดหนี้จากใบแจ้งหนี้ก่อน' }, { status: 400 })
    }
    // Document types belong to record kinds — the user's model, and Thai
    // practice: a quotation prints from a quotation; billing documents
    // (invoice, tax invoice, receipt) print from the invoice that was issued
    // as a งวด of it. Printing a quote AS a full-total invoice was the
    // Phase-2 shortcut that blurred the two.
    if (row?.kind === 'invoice' && type === 'quotation') {
      return Response.json({ error: 'A quotation cannot be printed from an invoice record' }, { status: 400 })
    }
    if (row && row.kind !== 'invoice' && row.kind !== 'credit_memo' && row.kind !== 'payroll_line' && type !== 'quotation') {
      return Response.json(
        { error: 'Billing documents print from an issued invoice — ออกใบแจ้งหนี้งวดจากใบเสนอราคาก่อน' },
        { status: 400 },
      )
    }
    const { document, sources, usedSample } = await withTenantRls(em, tenantId, async (tem) => {
      const settings = await loadSettings(tem, { tenantId, organizationId })
      return {
        sources: sourceRows,
        usedSample: !row,
        document: row?.kind === 'payroll_line'
          ? await documentFromPayroll(tem, { row, template, settings })
          : row
          ? await documentFromQuote(tem, { row, type, template, settings, brand, asOf })
          : await sampleDocumentForBrand(tem, { type, template, settings, brand, copies }),
      }
    })

    return Response.json({
      document,
      usedSample,
      sourceKind: row ? (typeof row.kind === 'string' && row.kind !== 'quote' ? String(row.kind) : 'quote') : 'sample',
      sources: sources.map(sourceOption),
    })
  } catch (error) {
    // A preview must never 500 opaquely — the operator needs to know whether
    // the record or the settings are at fault.
    logger.error('Document preview build failed', {
      type,
      documentId: documentId ?? null,
      err: error instanceof Error ? error.message : String(error),
    })
    return Response.json({ error: 'Could not build the document preview' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Documents',
  summary: 'Document preview model',
  methods: {
    GET: {
      summary: 'Build a printable document from a sales record (or sample data)',
      description:
        'Returns the presentation model for the requested Thai document type and template. Omit documentId to render built-in sample data.',
      tags: ['Orva Documents'],
      query: previewQuerySchema,
      responses: [{ status: 200, description: 'Printable document plus selectable sources.', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid query', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
