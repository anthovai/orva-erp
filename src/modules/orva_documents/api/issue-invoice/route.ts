import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import {
  resolveActiveOrganizationId,
  organizationScopeRequiredResponse,
} from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { issueInvoiceSchema } from '../../data/validators'
import { findQuoteById, loadSettings } from '../../lib/source'
import { resolveFinanceBridge } from '../../lib/financeBridge'

const logger = createLogger('orva_documents').child({ component: 'issue-invoice' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_documents.view'] },
  POST: { requireAuth: true, requireFeatures: ['sales.invoices.manage'] },
}

const responseSchema = z.object({
  id: z.string().uuid(),
  invoiceNumber: z.string(),
  installmentNo: z.number(),
  net: z.number(),
  tax: z.number(),
  gross: z.number(),
  /** ledger outcome: journal number, or why the books were not updated */
  accounting: z.object({ ok: z.boolean(), journalNo: z.string().optional(), reason: z.string().optional() }).optional(),
})

const installmentSchema = z.object({
  id: z.string().uuid(),
  invoiceNumber: z.string(),
  installmentNo: z.number().nullable(),
  installmentPercent: z.number().nullable(),
  issueDate: z.string().nullable(),
  dueDate: z.string().nullable(),
  paidDate: z.string().nullable(),
  grandTotal: z.number(),
  outstanding: z.number(),
})

/**
 * The installments already issued from a quote — what the quote screen shows
 * so nobody has to walk to the invoice list to find their own งวด.
 */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const quoteId = url.searchParams.get('quoteId')
  if (!quoteId || !/^[0-9a-f-]{36}$/i.test(quoteId)) {
    return Response.json({ error: 'quoteId is required' }, { status: 400 })
  }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const rows = (await em.fork().execute(
    `select id, invoice_number,
            (metadata->>'installmentNo')::int as installment_no,
            (metadata->>'installmentPercent')::numeric as installment_percent,
            metadata->>'paidDate' as paid_date,
            to_char(issue_date, 'YYYY-MM-DD') as issue_date,
            to_char(due_date, 'YYYY-MM-DD') as due_date,
            grand_total_gross_amount, outstanding_amount
     from sales_invoices
     where deleted_at is null and tenant_id = ?::uuid and metadata->>'quoteId' = ?
     order by created_at`,
    [auth.tenantId, quoteId],
  )) as Array<Record<string, unknown>>
  return Response.json({
    items: rows.map((row) => ({
      id: String(row.id),
      invoiceNumber: String(row.invoice_number),
      installmentNo: row.installment_no == null ? null : Number(row.installment_no),
      installmentPercent: row.installment_percent == null ? null : Number(row.installment_percent),
      issueDate: (row.issue_date as string) ?? null,
      dueDate: (row.due_date as string) ?? null,
      paidDate: (row.paid_date as string) ?? null,
      grandTotal: Number(row.grand_total_gross_amount ?? 0),
      outstanding: Number(row.outstanding_amount ?? 0),
    })),
  })
}

/**
 * Issues a REAL invoice record from a quote — the FlowAccount step where the
 * next document in the sequence is minted, not just printed.
 *
 * The carrier is upstream's sales_invoices (its own list, its own number
 * series). Upstream's invoice has no customer link — it is an order-billing
 * artifact and this business does not use orders — so the customer context
 * rides in `metadata`, copied from the quote at issue time. The number comes
 * from upstream's generator with OUR configured format: the invoice command
 * hardcodes the default format, so the number is minted first through
 * /api/sales/document-numbers and passed in explicitly.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()

  const parsed = issueInvoiceSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) {
    return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  }
  const { quoteId, amount, percent, description, dueInDays } = parsed.data

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const tenantId = auth.tenantId

  try {
    const forked = em.fork()
    const row = await findQuoteById(forked, { quoteId, tenantId })
    if (!row) return Response.json({ error: 'Quote not found' }, { status: 404 })

    const settings = await withTenantRls(em, tenantId, (tem) => loadSettings(tem, { tenantId, organizationId }))
    const format = settings?.invoiceNumberFormat?.trim() || undefined

    const subtotal = Number(row.subtotal_net_amount ?? 0)
    const net = amount ?? Math.round(subtotal * (percent ?? 0)) / 100
    if (!(net > 0)) return Response.json({ error: 'Invoice amount resolves to zero' }, { status: 400 })
    // Upstream's invoice command stores exactly what it is given — unlike
    // quotes there is no calculation engine behind it, and omitting totals
    // stores zeros. Compute the 7% VAT split here, rounded to satang.
    const tax = Math.round(net * 7) / 100
    const gross = Math.round((net + tax) * 100) / 100

    const cookie = req.headers.get('cookie') ?? ''
    const origin = new URL(req.url).origin
    const callSales = async (path: string, body: Record<string, unknown>) => {
      const res = await fetch(new URL(path, origin), {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(body),
      })
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
      if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(json).slice(0, 200)}`)
      return json ?? {}
    }

    // 1) mint the number in OUR series (the create command would otherwise
    //    fall back to upstream's hardcoded default format)
    const minted = (await callSales('/api/sales/document-numbers', {
      kind: 'invoice',
      ...(format ? { format } : {}),
    })) as { number?: string }
    if (!minted.number) return Response.json({ error: 'Could not allocate an invoice number' }, { status: 502 })

    // งวดที่เท่าไร: count the invoices already issued from this quote
    const priorRows = (await forked.execute(
      `select count(*)::int as n from sales_invoices
       where deleted_at is null and tenant_id = ?::uuid and metadata->>'quoteId' = ?`,
      [tenantId, quoteId],
    )) as Array<{ n: number }>
    const installmentNo = (priorRows[0]?.n ?? 0) + 1

    // 2) the invoice itself — one 7% VAT service line, customer context in metadata
    const label =
      description?.trim() ||
      `งวดที่ ${installmentNo}${percent != null ? ` (${percent}%)` : ''} ตามใบเสนอราคา ${String(row.quote_number ?? '')}`
    const issueDate = new Date().toISOString().slice(0, 10)
    const dueDate = dueInDays != null
      ? new Date(Date.now() + dueInDays * 86_400_000).toISOString().slice(0, 10)
      : undefined
    const created = (await callSales('/api/sales/invoices', {
      invoiceNumber: minted.number,
      issueDate,
      ...(dueDate ? { dueDate } : {}),
      currencyCode: String(row.currency_code ?? 'THB'),
      subtotalNetAmount: String(net),
      subtotalGrossAmount: String(gross),
      taxTotalAmount: String(tax),
      grandTotalNetAmount: String(net),
      grandTotalGrossAmount: String(gross),
      outstandingAmount: String(gross),
      metadata: {
        quoteId,
        quoteNumber: row.quote_number ?? null,
        installmentNo,
        installmentPercent: percent ?? null,
        customerEntityId: row.customer_entity_id ?? null,
        customerSnapshot: row.customer_snapshot ?? null,
        billingAddressSnapshot: row.billing_address_snapshot ?? null,
      },
      lines: [
        {
          kind: 'service',
          name: label,
          quantity: '1',
          currencyCode: String(row.currency_code ?? 'THB'),
          unitPriceNet: String(net),
          taxRate: '7',
          taxAmount: String(tax),
          totalNetAmount: String(net),
          totalGrossAmount: String(gross),
        },
      ],
    })) as { id?: string; invoiceId?: string }
    // the create command answers { invoiceId }, not { id }
    const createdId = created.invoiceId ?? created.id
    if (!createdId) return Response.json({ error: 'Invoice creation returned no id' }, { status: 502 })

    logger.info('Invoice issued from quote', { quoteId, invoiceId: createdId, invoiceNumber: minted.number, net })

    // The books hear about the invoice immediately (Dr AR / Cr revenue + VAT
    // out). Best-effort: the invoice exists either way; a failure is reported,
    // not thrown, so the operator can post it from AR Posting later.
    const bridge = resolveFinanceBridge(container)
    const accounting = bridge
      ? await bridge.postInvoice(em, { tenantId, organizationId, userId: auth.sub ?? null }, { invoiceId: createdId, date: issueDate })
      : { ok: false as const, reason: 'finance module not connected' }
    if (!accounting.ok) logger.warn('Invoice not posted to ledger', { invoiceId: createdId, reason: accounting.reason })

    return Response.json({
      id: createdId, invoiceNumber: minted.number, installmentNo, net, tax, gross,
      accounting: accounting.ok ? { ok: true, journalNo: accounting.journalNo } : { ok: false, reason: accounting.reason },
    })
  } catch (error) {
    logger.error('Issue invoice failed', {
      quoteId,
      err: error instanceof Error ? error.message : String(error),
    })
    return Response.json({ error: 'Could not issue the invoice' }, { status: 502 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Documents',
  summary: 'Issue an invoice from a quote',
  methods: {
    GET: {
      summary: 'List installments issued from a quote',
      tags: ['Orva Documents'],
      responses: [{ status: 200, description: 'Installment invoices of the quote.', schema: z.object({ items: z.array(installmentSchema) }) }],
      errors: [{ status: 400, description: 'quoteId missing', schema: z.object({ error: z.string() }) }],
    },
    POST: {
      summary: 'Create a real sales invoice (own number series) from a quote',
      description:
        'Mints the next number in the configured invoice series and creates a sales_invoices record carrying the quote\'s customer context in metadata. Amount is fixed or a percentage of the quote subtotal; the line carries 7% VAT.',
      tags: ['Orva Documents'],
      requestBody: { schema: issueInvoiceSchema },
      responses: [{ status: 200, description: 'The created invoice id and number.', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid payload or zero amount', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Quote not found', schema: z.object({ error: z.string() }) },
        { status: 502, description: 'Sales API rejected the operation', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
