import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { NOTE_REASONS, noteCreateSchema, noteListSchema } from '../../data/validators'
import { brandForNumber, loadBrands } from '../../lib/brands'
import { resolveFinanceBridge } from '../../lib/financeBridge'
import { findInvoiceById, loadSettings } from '../../lib/source'

const logger = createLogger('orva_documents').child({ component: 'notes' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_documents.view'] },
  POST: { requireAuth: true, requireFeatures: ['sales.credit_memos.manage'] },
}

const noteSchema = z.object({
  id: z.string(),
  number: z.string(),
  kind: z.enum(['credit', 'debit']),
  issueDate: z.string().nullable(),
  reasonCode: z.string().nullable(),
  reason: z.string().nullable(),
  net: z.string(),
  vat: z.string(),
  gross: z.string(),
  journalNo: z.string().nullable(),
})

const VAT_RATE = 7
const r2 = (n: number) => Math.round(n * 100) / 100

/** Notes already issued against an invoice. */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = noteListSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const rows = await withTenantRls(em, auth.tenantId, (tem) => tem.execute(
    `select m.id, m.credit_memo_number as number, coalesce(m.metadata->>'noteKind', 'credit') as kind,
            to_char(m.issue_date, 'YYYY-MM-DD') as issue_date, m.metadata->>'reasonCode' as reason_code, m.reason,
            m.grand_total_net_amount::text as net, m.tax_total_amount::text as vat, m.grand_total_gross_amount::text as gross,
            m.metadata->>'journalNo' as journal_no
     from sales_credit_memos m
     where m.deleted_at is null and m.tenant_id = ?::uuid and m.invoice_id = ?::uuid
     order by m.issue_date, m.credit_memo_number`,
    [auth.tenantId, parsed.data.invoiceId],
  )) as Array<Record<string, string | null>>
  return Response.json({
    items: rows.map((r) => ({ id: r.id, number: r.number, kind: r.kind, issueDate: r.issue_date, reasonCode: r.reason_code, reason: r.reason, net: r.net, vat: r.vat, gross: r.gross, journalNo: r.journal_no })),
    reasons: NOTE_REASONS,
  })
}

/**
 * Issues a ใบลดหนี้ / ใบเพิ่มหนี้ against a tax invoice (ป.82/2542): numbers it in
 * the invoice's brand series (CN-/DN- variant of the invoice format), stores
 * it as an upstream credit memo carrying the original-invoice reference,
 * reason code, customer snapshot and the correct/difference amounts, then
 * posts it to the ledger through the finance bridge.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.sub) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = noteCreateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const input = parsed.data
  const tenantId = auth.tenantId
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const row = await findInvoiceById(em.fork(), { invoiceId: input.invoiceId, tenantId })
    if (!row) return Response.json({ error: 'Invoice not found' }, { status: 404 })
    const invoiceNumber = String(row.quote_number ?? '')
    const [settings, brands] = await withTenantRls(em, tenantId, async (tem) => Promise.all([
      loadSettings(tem, { tenantId, organizationId }),
      loadBrands(tem, { tenantId, organizationId }),
    ]))
    const brand = brandForNumber(invoiceNumber, brands)

    // amounts: lines carry net prices; VAT 7% like the invoice
    const lines = input.lines.map((line, index) => {
      const net = r2(line.quantity * line.unitPriceNet)
      const vat = r2(net * VAT_RATE / 100)
      return {
        lineNumber: index + 1, name: line.description, quantity: line.quantity, currencyCode: 'THB',
        unitPriceNet: line.unitPriceNet, unitPriceGross: r2(line.unitPriceNet * (1 + VAT_RATE / 100)),
        taxRate: VAT_RATE, taxAmount: vat, totalNetAmount: net, totalGrossAmount: r2(net + vat),
      }
    })
    const net = r2(lines.reduce((s, l) => s + l.totalNetAmount, 0))
    const vat = r2(lines.reduce((s, l) => s + l.taxAmount, 0))
    const gross = r2(net + vat)
    if (!(gross > 0)) return Response.json({ error: 'Note amount must be positive' }, { status: 400 })
    const originalTotal = Number(row.grand_total_gross_amount ?? 0)
    const correctTotal = r2(input.kind === 'credit' ? originalTotal - gross : originalTotal + gross)
    if (input.kind === 'credit' && correctTotal < -0.005) return Response.json({ error: 'ลดหนี้เกินมูลค่าใบกำกับภาษีเดิม' }, { status: 400 })
    const reasonLabel = NOTE_REASONS[input.kind].find((r) => r.code === input.reasonCode)?.label ?? input.reasonCode

    // number in the invoice's series: KKG-INV-… → KKG-CN-… / KKG-DN-…
    const invoiceFormat = settings?.invoiceNumberFormat?.trim() || 'INV-{yyyy}{mm}{dd}-{seq:5}'
    const tag = input.kind === 'credit' ? 'CN' : 'DN'
    const format = /INV/.test(invoiceFormat) ? invoiceFormat.replace('INV', tag) : `${tag}-${invoiceFormat}`
    const cookie = req.headers.get('cookie') ?? ''
    const origin = new URL(req.url).origin
    const call = async <T,>(path: string, body: Record<string, unknown>): Promise<T> => {
      const res = await fetch(new URL(path, origin), { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) })
      const json = (await res.json().catch(() => null)) as T | null
      if (!res.ok) throw Object.assign(new Error(`${path} → ${res.status} ${JSON.stringify(json).slice(0, 160)}`), { status: 502 })
      return (json ?? {}) as T
    }
    const minted = await call<{ number?: string }>('/api/sales/document-numbers', { kind: 'credit_memo', format, ...(brand ? { brand: brand.code } : {}) })
    if (!minted.number) return Response.json({ error: 'Could not allocate a note number' }, { status: 502 })

    const created = await call<{ id?: string; creditMemoId?: string }>('/api/sales/credit-memos', {
      invoiceId: input.invoiceId,
      creditMemoNumber: minted.number,
      issueDate: input.issueDate,
      reason: input.reason ?? undefined,
      currencyCode: 'THB',
      lines,
      subtotalNetAmount: net, subtotalGrossAmount: gross, taxTotalAmount: vat, grandTotalNetAmount: net, grandTotalGrossAmount: gross,
      metadata: {
        noteKind: input.kind,
        reasonCode: input.reasonCode,
        reasonLabel,
        originalInvoiceId: input.invoiceId,
        originalInvoiceNumber: invoiceNumber,
        originalInvoiceDate: row.issue_date ?? null,
        originalTotal,
        correctTotal,
        customerEntityId: row.customer_entity_id ?? null,
        customerSnapshot: row.customer_snapshot ?? null,
        billingAddressSnapshot: row.billing_address_snapshot ?? null,
        brandCode: brand?.code ?? null,
        source: 'orva_documents.notes',
      },
    })
    const noteId = created.creditMemoId ?? created.id
    if (!noteId) return Response.json({ error: 'Credit memo was not created' }, { status: 502 })

    // books
    const bridge = resolveFinanceBridge(container)
    let accounting: { ok: boolean; journalNo?: string; reason?: string } = { ok: false, reason: 'finance module not connected' }
    if (bridge) {
      accounting = await bridge.postNote(em, { tenantId, organizationId, userId: auth.sub }, {
        noteId, noteNumber: minted.number, invoiceNumber, kind: input.kind, date: input.issueDate, net, vat,
      })
      if (accounting.ok && accounting.journalNo) {
        await withTenantRls(em, tenantId, (tem) => tem.execute(
          `update sales_credit_memos set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('journalNo', ?::text), updated_at = now() where id = ?::uuid and tenant_id = ?::uuid`,
          [accounting.journalNo, noteId, tenantId],
        ))
      } else if (!accounting.ok) {
        logger.warn('Note not booked to ledger', { noteId, reason: accounting.reason })
      }
    }
    return Response.json({
      ok: true, id: noteId, number: minted.number, kind: input.kind, net, vat, gross, correctTotal, accounting,
      preview: `/backend/documents/preview?type=${input.kind === 'credit' ? 'credit_note' : 'debit_note'}&documentId=${noteId}`,
    })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    logger.error('Note creation failed', { err: error instanceof Error ? error.message : String(error) })
    return Response.json({ error: error instanceof Error ? error.message : 'Could not issue the note' }, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Documents',
  summary: 'Credit / debit notes (ใบลดหนี้ / ใบเพิ่มหนี้)',
  methods: {
    GET: { summary: 'Notes issued against an invoice, plus the RD reason codes', tags: ['Orva Documents'], query: noteListSchema, responses: [{ status: 200, description: 'Notes.', schema: z.object({ items: z.array(noteSchema), reasons: z.unknown() }) }] },
    POST: { summary: 'Issue a credit or debit note against a tax invoice and post it', tags: ['Orva Documents'], requestBody: { schema: noteCreateSchema }, responses: [{ status: 200, description: 'Issued.', schema: z.object({ ok: z.boolean(), id: z.string(), number: z.string(), preview: z.string() }) }] },
  },
}
