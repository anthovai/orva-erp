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
import { recordPaymentSchema } from '../../data/validators'
import { resolveFinanceBridge } from '../../lib/financeBridge'

const logger = createLogger('orva_documents').child({ component: 'record-payment' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_documents.view'] },
  POST: { requireAuth: true, requireFeatures: ['sales.invoices.manage'] },
}

const paymentContextSchema = z.object({
  id: z.string().uuid(),
  invoiceNumber: z.string(),
  gross: z.number(),
  net: z.number(),
  tax: z.number(),
  outstanding: z.number(),
  paidDate: z.string().nullable(),
  dueDate: z.string().nullable(),
  /** Echo back with the POST as the optimistic-lock version. */
  updatedAt: z.string().nullable(),
})

const resultSchema = z.object({
  id: z.string().uuid(),
  paidDate: z.string(),
  paidTotal: z.number(),
  outstanding: z.number(),
  /** ledger outcome: receipt + journal numbers, or why the books were not updated */
  accounting: z.object({ ok: z.boolean(), journalNo: z.string().optional(), receiptNo: z.string().nullable().optional(), reason: z.string().optional() }).optional(),
})

type InvoiceRow = {
  id: string
  invoice_number: string
  grand_total_gross_amount: string | null
  grand_total_net_amount: string | null
  tax_total_amount: string | null
  outstanding_amount: string | null
  due_date: string | null
  metadata: Record<string, unknown> | null
  updated_at: string | null
}

async function loadInvoice(em: EntityManager, tenantId: string, invoiceId: string): Promise<InvoiceRow | null> {
  const rows = (await em.execute(
    `select id, invoice_number, grand_total_gross_amount, grand_total_net_amount,
            tax_total_amount, outstanding_amount,
            to_char(due_date, 'YYYY-MM-DD') as due_date, metadata,
            to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at
     from sales_invoices
     where deleted_at is null and tenant_id = ?::uuid and id = ?::uuid`,
    [tenantId, invoiceId],
  )) as InvoiceRow[]
  return rows[0] ?? null
}

/** The figures the dialog needs before recording: totals + what is still owed. */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const invoiceId = url.searchParams.get('invoiceId')
  if (!invoiceId || !/^[0-9a-f-]{36}$/i.test(invoiceId)) {
    return Response.json({ error: 'invoiceId is required' }, { status: 400 })
  }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const row = await loadInvoice(em.fork(), auth.tenantId, invoiceId)
  if (!row) return Response.json({ error: 'Invoice not found' }, { status: 404 })
  const meta = (row.metadata ?? {}) as Record<string, unknown>
  return Response.json({
    id: row.id,
    invoiceNumber: row.invoice_number,
    gross: Number(row.grand_total_gross_amount ?? 0),
    net: Number(row.grand_total_net_amount ?? 0),
    tax: Number(row.tax_total_amount ?? 0),
    outstanding: Number(row.outstanding_amount ?? 0),
    paidDate: typeof meta.paidDate === 'string' ? meta.paidDate : null,
    dueDate: row.due_date ?? null,
    updatedAt: row.updated_at ?? null,
  })
}

/**
 * Records a payment against an issued invoice — the FlowAccount step after
 * the customer's transfer slip arrives. Cash received + withholding tax
 * together settle the bill (the 3% WHT is money the buyer remits to the
 * Revenue Department on the seller's behalf, not a shortfall).
 *
 * The write is a direct scoped UPDATE inside withTenantRls, NOT upstream's
 * PUT /api/sales/invoices: that route's command diffs the payload with
 * buildChanges() — which returns audit-style {from,to} records — and then
 * Object.assigns those records onto the entity, so any partial update crashes
 * with a MikroORM ValidationError ("Trying to set SalesInvoice.issueDate …
 * to { from, to }"). Until that is fixed upstream, this route owns the write:
 * metadata is merged (quote linkage must survive) and updated_at doubles as
 * the optimistic lock — a stale version is a 409, per the app's rules.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()

  const parsed = recordPaymentSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) {
    return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  }
  const { invoiceId, paidDate, amountReceived, whtAmount, note, updatedAt } = parsed.data

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const row = await loadInvoice(em.fork(), auth.tenantId, invoiceId)
    if (!row) return Response.json({ error: 'Invoice not found' }, { status: 404 })

    const gross = Number(row.grand_total_gross_amount ?? 0)
    const paidTotal = Math.round((amountReceived + whtAmount) * 100) / 100
    if (paidTotal > gross + 0.005) {
      return Response.json({ error: 'Payment exceeds the invoice total' }, { status: 400 })
    }
    const outstanding = Math.max(0, Math.round((gross - paidTotal) * 100) / 100)

    const metadata = {
      ...((row.metadata ?? {}) as Record<string, unknown>),
      paidDate,
      receivedAmount: amountReceived,
      whtAmount,
      ...(note ? { paymentNote: note } : {}),
    }

    const updatedRows = await withTenantRls(em, auth.tenantId, async (tem) =>
      (await tem.execute(
        `update sales_invoices
         set paid_total_amount = ?, outstanding_amount = ?, metadata = ?::jsonb, updated_at = now()
         where id = ?::uuid and tenant_id = ?::uuid and deleted_at is null
           and updated_at = ?::timestamptz
         returning id`,
        [String(paidTotal), String(outstanding), JSON.stringify(metadata), invoiceId, auth.tenantId, updatedAt],
      )) as Array<{ id: string }>,
    )
    if (updatedRows.length === 0) {
      // The row exists (loaded above) — the version no longer matches.
      return Response.json({ error: 'Conflict — reload and retry' }, { status: 409 })
    }

    // Books: Dr bank (cash received) / Dr WHT receivable / Cr AR. If the
    // invoice was never posted (e.g. issued before finance was configured)
    // the bridge posts it first on the same date, then books the receipt.
    const bridge = resolveFinanceBridge(container)
    const scope = { tenantId: auth.tenantId, organizationId, userId: auth.sub ?? null }
    let accounting: { ok: true; journalNo: string; receiptNo?: string | null } | { ok: false; reason: string } =
      { ok: false, reason: 'finance module not connected' }
    if (bridge) {
      const posted = await bridge.postInvoice(em, scope, { invoiceId, date: paidDate })
      accounting = posted.ok
        ? await bridge.recordReceipt(em, scope, { invoiceId, date: paidDate, cashReceived: amountReceived, wht: whtAmount, note })
        : posted
    }
    if (!accounting.ok) logger.warn('Receipt not booked to ledger', { invoiceId, reason: accounting.reason })

    return Response.json({
      id: invoiceId, paidDate, paidTotal, outstanding,
      accounting: accounting.ok
        ? { ok: true, journalNo: accounting.journalNo, receiptNo: accounting.receiptNo ?? null }
        : { ok: false, reason: accounting.reason },
    })
  } catch (error) {
    logger.error('Record payment failed', {
      invoiceId,
      err: error instanceof Error ? error.message : String(error),
    })
    return Response.json({ error: 'Could not record the payment' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Documents',
  summary: 'Record a payment against an issued invoice',
  methods: {
    GET: {
      summary: 'Payment context for one invoice (totals, outstanding, paid date)',
      tags: ['Orva Documents'],
      responses: [{ status: 200, description: 'Invoice payment context.', schema: paymentContextSchema }],
      errors: [
        { status: 400, description: 'invoiceId missing', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Invoice not found', schema: z.object({ error: z.string() }) },
      ],
    },
    POST: {
      summary: 'Record cash received (+ withholding tax) and stamp the paid date',
      description:
        'Updates paid/outstanding totals through the sales invoice command and stores paidDate/receivedAmount/whtAmount in the invoice metadata. The receipt document prints the paid date from here.',
      tags: ['Orva Documents'],
      requestBody: { schema: recordPaymentSchema },
      responses: [{ status: 200, description: 'Payment recorded.', schema: resultSchema }],
      errors: [
        { status: 400, description: 'Invalid payload or amount exceeds the invoice total', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Invoice not found', schema: z.object({ error: z.string() }) },
        { status: 409, description: 'Concurrent update — reload and retry', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
