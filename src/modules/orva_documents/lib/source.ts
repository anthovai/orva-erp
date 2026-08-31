import type { EntityManager } from '@mikro-orm/postgresql'
import { DocumentSettings } from '../data/entities'
import {
  buildPrintableDocument,
  sampleBuyer,
  sampleSource,
  type DocumentLine,
  type DocumentSource,
  type DocumentType,
  type Party,
  type PrintableDocument,
  type TemplateId,
} from './document'

/**
 * Reading a sales record as a Thai document.
 *
 * Two callers need exactly the same mapping and must never drift apart: the
 * staff preview and the token-scoped page the customer opens. If they built
 * the document differently, staff would approve one sheet and the customer
 * would receive another.
 *
 * Sales data is read with raw SQL rather than its entities because a
 * cross-module ORM relation is not allowed here; the queries stay inside the
 * caller's RLS transaction, so the database enforces tenant isolation.
 */

const num = (value: unknown) => Number(value ?? 0)

export const isoDate = (value: unknown) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : typeof value === 'string' ? value.slice(0, 10) : null

export type QuoteRow = Record<string, unknown>

export async function loadSettings(
  tem: EntityManager,
  scope: { tenantId: string; organizationId: string | null },
): Promise<DocumentSettings | null> {
  return tem.findOne(DocumentSettings, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
}

export function templateFor(type: DocumentType, settings: DocumentSettings | null): TemplateId {
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

export function sellerFrom(settings: DocumentSettings | null): Party {
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

const QUOTE_COLUMNS = `q.id, q.quote_number, q.currency_code, q.customer_entity_id, q.customer_snapshot,
       q.tenant_id, q.organization_id,
       to_char(coalesce(q.placed_at, q.created_at), 'YYYY-MM-DD') as issue_date,
       to_char(q.valid_until, 'YYYY-MM-DD') as valid_until,
       q.subtotal_net_amount, q.discount_total_amount, q.tax_total_amount, q.grand_total_gross_amount`

export async function findQuoteById(
  tem: EntityManager,
  args: { quoteId: string; tenantId: string },
): Promise<QuoteRow | null> {
  const rows = (await tem.execute(
    `select ${QUOTE_COLUMNS}
     from sales_quotes q
     where q.id = ?::uuid and q.deleted_at is null and q.tenant_id = ?::uuid`,
    [args.quoteId, args.tenantId],
  )) as QuoteRow[]
  return rows[0] ?? null
}

/**
 * Resolves the quote a customer's link points at. The token is stored hashed,
 * exactly as the sales module stores it, so the raw token never has to be
 * comparable to anything on disk.
 */
export async function findQuoteByHashedToken(
  tem: EntityManager,
  hashedToken: string,
): Promise<QuoteRow | null> {
  const rows = (await tem.execute(
    `select ${QUOTE_COLUMNS}
     from sales_quotes q
     where q.acceptance_token = ? and q.deleted_at is null`,
    [hashedToken],
  )) as QuoteRow[]
  return rows[0] ?? null
}

export async function listQuoteSources(
  tem: EntityManager,
  scope: { tenantId: string; organizationId: string | null },
): Promise<QuoteRow[]> {
  return (await tem.execute(
    `select q.id, q.quote_number, to_char(coalesce(q.placed_at, q.created_at), 'YYYY-MM-DD') as issue_date,
            q.customer_snapshot
     from sales_quotes q
     where q.deleted_at is null
       and q.tenant_id = ?::uuid
       and (?::uuid is null or q.organization_id = ?::uuid)
     order by q.created_at desc
     limit 25`,
    [scope.tenantId, scope.organizationId, scope.organizationId],
  )) as QuoteRow[]
}

async function loadQuoteLines(tem: EntityManager, quoteId: string): Promise<QuoteRow[]> {
  return (await tem.execute(
    `select name, description, quantity, unit_price_net, total_net_amount
     from sales_quote_lines
     where quote_id = ?::uuid and deleted_at is null
     order by line_number`,
    [quoteId],
  )) as QuoteRow[]
}

/**
 * The buyer's taxpayer id lives on the company record as the Thai custom field
 * Orva adds (`orva/ce.ts`). A tax invoice is legally deficient without it, so
 * its absence has to surface as a warning rather than an empty cell.
 *
 * `custom_field_values.record_id` is TEXT, hence the explicit cast — comparing
 * it to a uuid parameter is a hard Postgres error, not a silent mismatch.
 */
async function loadBuyerTaxId(tem: EntityManager, customerEntityId: unknown): Promise<string | null> {
  if (!customerEntityId) return null
  const rows = (await tem.execute(
    `select value_text from custom_field_values
     where record_id = ?::text and field_key = 'th_tax_id' and deleted_at is null
     limit 1`,
    [String(customerEntityId)],
  )) as QuoteRow[]
  return rows[0]?.value_text ? String(rows[0].value_text) : null
}

function partyFromSnapshot(row: QuoteRow, taxId: string | null): Party {
  const snapshot = (row.customer_snapshot ?? {}) as Record<string, unknown>
  return {
    name:
      (typeof snapshot.displayName === 'string' && snapshot.displayName) ||
      (typeof snapshot.name === 'string' && snapshot.name) ||
      'ลูกค้าทั่วไป',
    taxId,
    branch: null,
    address: typeof snapshot.address === 'string' ? snapshot.address : null,
    email: typeof snapshot.primaryEmail === 'string' ? snapshot.primaryEmail : null,
  }
}

function sourceFromQuote(row: QuoteRow, lines: QuoteRow[]): DocumentSource {
  const docLines: DocumentLine[] = lines.map((line) => ({
    description: String(line.name ?? line.description ?? ''),
    quantity: num(line.quantity),
    unitPrice: num(line.unit_price_net),
    amount: num(line.total_net_amount),
  }))
  const subtotal = num(row.subtotal_net_amount)
  const taxAmount = num(row.tax_total_amount)
  return {
    number: String(row.quote_number ?? ''),
    issueDate: isoDate(row.issue_date) ?? '',
    secondaryDate: isoDate(row.valid_until),
    currencyCode: String(row.currency_code ?? 'THB'),
    lines: docLines,
    subtotal,
    discount: num(row.discount_total_amount),
    // Present the effective rate the record actually carries; never re-derive.
    taxRate: subtotal > 0 ? Math.round((taxAmount / subtotal) * 10000) / 100 : null,
    taxAmount,
    grandTotal: num(row.grand_total_gross_amount),
    // sales encrypts `comments` at rest and this raw read bypasses the
    // decryption helpers, so the stored value is ciphertext. Printing it
    // would put garbage on the sheet.
    note: null,
    paymentMethod: null,
  }
}

/** Builds the printable document for one already-loaded quote row. */
export async function documentFromQuote(
  tem: EntityManager,
  args: { row: QuoteRow; type: DocumentType; template?: TemplateId; settings: DocumentSettings | null },
): Promise<PrintableDocument> {
  const [lines, buyerTaxId] = await Promise.all([
    loadQuoteLines(tem, String(args.row.id)),
    loadBuyerTaxId(tem, args.row.customer_entity_id),
  ])
  return buildPrintableDocument({
    type: args.type,
    template: args.template ?? templateFor(args.type, args.settings),
    seller: sellerFrom(args.settings),
    buyer: partyFromSnapshot(args.row, buyerTaxId),
    source: sourceFromQuote(args.row, lines),
  })
}

/** Sample sheet for tenants with no sales records yet. */
export function sampleDocument(args: {
  type: DocumentType
  template?: TemplateId
  settings: DocumentSettings | null
}): PrintableDocument {
  return buildPrintableDocument({
    type: args.type,
    template: args.template ?? templateFor(args.type, args.settings),
    seller: sellerFrom(args.settings),
    buyer: sampleBuyer(),
    source: sampleSource(),
  })
}

export function sourceOption(row: QuoteRow) {
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
}
