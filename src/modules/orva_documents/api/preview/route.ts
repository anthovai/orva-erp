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
import { DocumentSettings } from '../../data/entities'
import { previewQuerySchema } from '../../data/validators'
import {
  buildPrintableDocument,
  sampleBuyer,
  sampleSource,
  type DocumentLine,
  type DocumentSource,
  type DocumentType,
  type Party,
  type TemplateId,
} from '../../lib/document'

const logger = createLogger('orva_documents').child({ component: 'preview' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_documents.view'] },
}

const sourceOptionSchema = z.object({
  id: z.string(),
  number: z.string(),
  issueDate: z.string().nullable(),
  customerName: z.string().nullable(),
})

const responseSchema = z.object({
  document: z.record(z.string(), z.unknown()),
  sources: z.array(sourceOptionSchema),
  usedSample: z.boolean(),
})

function templateFor(type: DocumentType, settings: DocumentSettings | null): TemplateId {
  const fallback: TemplateId = 'classic'
  if (!settings) return fallback
  const byType: Record<DocumentType, string> = {
    quotation: settings.templateQuotation,
    invoice: settings.templateInvoice,
    tax_invoice: settings.templateTaxInvoice,
    receipt: settings.templateReceipt,
  }
  const chosen = byType[type]
  return chosen === 'modern' || chosen === 'compact' ? chosen : fallback
}

function sellerFrom(settings: DocumentSettings | null): Party {
  if (!settings) {
    return { name: 'ยังไม่ได้ตั้งค่าข้อมูลผู้ขาย', taxId: null, branch: null }
  }
  return {
    name: settings.sellerName,
    taxId: settings.sellerTaxId ?? null,
    branch: settings.sellerBranch ?? null,
    address: settings.sellerAddress ?? null,
    phone: settings.sellerPhone ?? null,
    email: settings.sellerEmail ?? null,
  }
}

const num = (value: unknown) => Number(value ?? 0)
const isoDate = (value: unknown) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : typeof value === 'string' ? value.slice(0, 10) : null

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
  const { type, documentId } = parsed.data

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const tenantId = auth.tenantId

  try {

  const { settings, sources, record, lines, buyerTaxId } = await withTenantRls(em, tenantId, async (tem) => {
    const settingsRow = await tem.findOne(DocumentSettings, { tenantId, organizationId, deletedAt: null })

    const sourceRows = (await tem.execute(
      `select q.id, q.quote_number, to_char(coalesce(q.placed_at, q.created_at), 'YYYY-MM-DD') as issue_date,
              q.customer_snapshot
       from sales_quotes q
       where q.deleted_at is null
         and q.tenant_id = ?::uuid
         and (?::uuid is null or q.organization_id = ?::uuid)
       order by q.created_at desc
       limit 25`,
      [tenantId, organizationId, organizationId],
    )) as Array<Record<string, unknown>>

    if (!documentId) return { settings: settingsRow, sources: sourceRows, record: null, lines: [], buyerTaxId: null }

    const recordRows = (await tem.execute(
      `select q.id, q.quote_number, q.currency_code, q.customer_entity_id, q.customer_snapshot,
              to_char(coalesce(q.placed_at, q.created_at), 'YYYY-MM-DD') as issue_date,
              to_char(q.valid_until, 'YYYY-MM-DD') as valid_until,
              q.subtotal_net_amount, q.discount_total_amount, q.tax_total_amount, q.grand_total_gross_amount
       from sales_quotes q
       where q.id = ?::uuid and q.deleted_at is null and q.tenant_id = ?::uuid`,
      [documentId, tenantId],
    )) as Array<Record<string, unknown>>
    const found = recordRows[0] ?? null

    const lineRows = found
      ? ((await tem.execute(
          `select name, description, quantity, unit_price_net, total_net_amount
           from sales_quote_lines
           where quote_id = ?::uuid and deleted_at is null
           order by line_number`,
          [documentId],
        )) as Array<Record<string, unknown>>)
      : []

    // The buyer's taxpayer id lives on the company record as the Thai custom
    // field Orva adds (orva/ce.ts) — a tax invoice is deficient without it.
    let taxId: string | null = null
    if (found?.customer_entity_id) {
      const cfRows = (await tem.execute(
        `select value_text from custom_field_values
         where record_id = ?::text and field_key = 'th_tax_id' and deleted_at is null
         limit 1`,
        [String(found.customer_entity_id)],
      )) as Array<Record<string, unknown>>
      taxId = cfRows[0]?.value_text ? String(cfRows[0].value_text) : null
    }

    return { settings: settingsRow, sources: sourceRows, record: found, lines: lineRows, buyerTaxId: taxId }
  })

  const template: TemplateId = (parsed.data.template as TemplateId | undefined) ?? templateFor(type, settings)
  const seller = sellerFrom(settings)

  let source: DocumentSource
  let buyer: Party
  let usedSample = false

  if (record) {
    const snapshot = (record.customer_snapshot ?? {}) as Record<string, unknown>
    const docLines: DocumentLine[] = lines.map((line) => ({
      description: String(line.name ?? line.description ?? ''),
      quantity: num(line.quantity),
      unitPrice: num(line.unit_price_net),
      amount: num(line.total_net_amount),
    }))
    const subtotal = num(record.subtotal_net_amount)
    const taxAmount = num(record.tax_total_amount)
    source = {
      number: String(record.quote_number ?? ''),
      issueDate: isoDate(record.issue_date) ?? '',
      secondaryDate: isoDate(record.valid_until),
      currencyCode: String(record.currency_code ?? 'THB'),
      lines: docLines,
      subtotal,
      discount: num(record.discount_total_amount),
      // Present the effective rate the record actually carries; never re-derive.
      taxRate: subtotal > 0 ? Math.round((taxAmount / subtotal) * 10000) / 100 : null,
      taxAmount,
      grandTotal: num(record.grand_total_gross_amount),
      // sales encrypts `comments` at rest and this raw read bypasses the
      // decryption helpers, so the stored value is ciphertext. Printing it
      // would put garbage on the sheet, so notes stay out until the record
      // is loaded through findOneWithDecryption.
      note: null,
      paymentMethod: null,
    }
    buyer = {
      name:
        (typeof snapshot.displayName === 'string' && snapshot.displayName) ||
        (typeof snapshot.name === 'string' && snapshot.name) ||
        'ลูกค้าทั่วไป',
      taxId: buyerTaxId,
      branch: null,
      address: typeof snapshot.address === 'string' ? snapshot.address : null,
      email: typeof snapshot.primaryEmail === 'string' ? snapshot.primaryEmail : null,
    }
  } else {
    usedSample = true
    source = sampleSource()
    buyer = sampleBuyer()
  }

  const document = buildPrintableDocument({ type, template, seller, buyer, source })

  return Response.json({
    document,
    usedSample,
    sources: sources.map((row) => {
      const snapshot = (row.customer_snapshot ?? {}) as Record<string, unknown>
      return {
        id: String(row.id),
        number: String(row.quote_number ?? ''),
        issueDate: isoDate(row.issue_date),
        customerName:
          (typeof snapshot.displayName === 'string' && snapshot.displayName) ||
          (typeof snapshot.name === 'string' && snapshot.name) ||
          null,
      }
    }),
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
