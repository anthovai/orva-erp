import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { parseDecryptedFieldValue } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { SalesCreditMemo, SalesCreditMemoLine, SalesInvoice, SalesInvoiceLine, SalesQuote, SalesQuoteLine } from '@open-mercato/core/modules/sales/data/entities'
import { DocumentSettings } from '../data/entities'
import { brandForNumber, loadBrands, settingsWithBrand } from './brands'
import {
  buildPrintableDocument,
  sampleBuyer,
  sampleEmployee,
  samplePayslipSource,
  sampleSource,
  type DocumentLine,
  type DocumentReference,
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
 * Quotes are read through the sales entities WITH the decryption helpers —
 * sales encrypts customer_snapshot and comments at rest, so a raw SQL read
 * returns ciphertext and the sheet would print "ลูกค้าทั่วไป" for every real
 * customer (exactly what happened with the first real record; the demo rows
 * predated encryption, which hid it). No cross-module ORM relation is used:
 * these are scalar-filtered reads of installed entities inside the caller's
 * RLS transaction.
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
    // the retail slip shares the receipt's template choice
    abbreviated_tax_invoice: settings.templateReceipt,
    // notes correct a tax invoice, so they print like one; the billing note like an invoice
    credit_note: settings.templateTaxInvoice,
    debit_note: settings.templateTaxInvoice,
    billing_note: settings.templateInvoice,
    // the payslip has its own layout; the template choice only sets the accent
    payslip: settings.templateInvoice,
  }
  const chosen = byType[type]
  return chosen === 'modern' || chosen === 'compact' || chosen === 'brand' ? (chosen as TemplateId) : fallback
}

export function sellerFrom(settings: DocumentSettings | null): Party {
  if (!settings) {
    return { name: 'ยังไม่ได้ตั้งค่าข้อมูลผู้ขาย', taxId: null, branch: null }
  }
  return {
    name: settings.sellerName,
    legalName: settings.sellerLegalName ?? null,
    taxId: settings.sellerTaxId ?? null,
    branch: settings.sellerBranch ?? null,
    address: settings.sellerAddress ?? null,
    phone: settings.sellerPhone ?? null,
    email: settings.sellerEmail ?? null,
  }
}

/**
 * A decrypted json field comes back as the ENCODED STRING of the original
 * value, not the object — every sales reader runs it through
 * parseDecryptedFieldValue (see sales/api/documents/factory.ts
 * normalizeJsonRecord). Skipping the parse is exactly the bug that printed
 * every real customer as "ลูกค้าทั่วไป" while the ciphertext looked decrypted.
 */
function jsonRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return {}
  const parsed = parseDecryptedFieldValue(value)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {}
}

function decryptedText(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return value == null ? null : String(value)
  const parsed = parseDecryptedFieldValue(value)
  return typeof parsed === 'string' ? parsed : String(value)
}

/** Flattens a decrypted SalesQuote into the row shape this file consumes. */
function rowFromQuote(quote: SalesQuote): QuoteRow {
  return {
    id: quote.id,
    quote_number: quote.quoteNumber,
    currency_code: quote.currencyCode,
    customer_entity_id: (quote as { customerEntityId?: string | null }).customerEntityId ?? null,
    customer_snapshot: jsonRecord(quote.customerSnapshot),
    billing_address_snapshot: jsonRecord((quote as { billingAddressSnapshot?: unknown }).billingAddressSnapshot),
    tenant_id: quote.tenantId,
    organization_id: quote.organizationId,
    issue_date: isoDate(quote.placedAt ?? quote.createdAt),
    valid_until: isoDate(quote.validUntil),
    subtotal_net_amount: quote.subtotalNetAmount,
    discount_total_amount: quote.discountTotalAmount,
    tax_total_amount: quote.taxTotalAmount,
    grand_total_gross_amount: quote.grandTotalGrossAmount,
    comments: decryptedText((quote as { comments?: string | null }).comments ?? null),
  }
}

export async function findQuoteById(
  tem: EntityManager,
  args: { quoteId: string; tenantId: string },
): Promise<QuoteRow | null> {
  const quote = await findOneWithDecryption(
    tem, SalesQuote,
    { id: args.quoteId, deletedAt: null },
    {},
    { tenantId: args.tenantId },
  )
  if (!quote || quote.tenantId !== args.tenantId) return null
  return rowFromQuote(quote)
}

/**
 * An invoice issued from a quote (see api/issue-invoice). Upstream's invoice
 * carries no customer link; the context this module wrote into metadata at
 * issue time is the buyer. Only invoice-family documents can be printed from
 * it — a quotation cannot be derived from an invoice record.
 */
export async function findInvoiceById(
  tem: EntityManager,
  args: { invoiceId: string; tenantId: string },
): Promise<QuoteRow | null> {
  const invoice = await findOneWithDecryption(
    tem, SalesInvoice,
    { id: args.invoiceId, deletedAt: null },
    {},
    { tenantId: args.tenantId },
  )
  if (!invoice || invoice.tenantId !== args.tenantId) return null
  const metadata = jsonRecord(invoice.metadata)
  return {
    id: invoice.id,
    kind: 'invoice',
    quote_number: invoice.invoiceNumber,
    currency_code: invoice.currencyCode,
    customer_entity_id: metadata.customerEntityId ?? null,
    customer_snapshot: jsonRecord(metadata.customerSnapshot),
    billing_address_snapshot: jsonRecord(metadata.billingAddressSnapshot),
    tenant_id: invoice.tenantId,
    organization_id: invoice.organizationId,
    issue_date: isoDate(invoice.issueDate ?? invoice.createdAt),
    valid_until: isoDate(metadata.paidDate ?? invoice.dueDate),
    subtotal_net_amount: invoice.subtotalNetAmount,
    discount_total_amount: invoice.discountTotalAmount,
    tax_total_amount: invoice.taxTotalAmount,
    grand_total_gross_amount: invoice.grandTotalGrossAmount,
    comments: typeof metadata.note === 'string' ? metadata.note : null,
  }
}

async function loadInvoiceLines(tem: EntityManager, invoiceId: string): Promise<QuoteRow[]> {
  const lines = await findWithDecryption(
    tem, SalesInvoiceLine,
    // invoice lines carry no soft-delete column; the invoice's own does
    { invoice: invoiceId },
    { orderBy: { lineNumber: 'asc' } },
  )
  return lines.map((line) => ({
    name: line.name ?? null,
    description: line.description ?? null,
    quantity: line.quantity,
    unit_price_net: line.unitPriceNet,
    total_net_amount: line.totalNetAmount,
    tax_rate: line.taxRate,
  }))
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
  const quote = await findOneWithDecryption(tem, SalesQuote, { acceptanceToken: hashedToken, deletedAt: null })
  return quote ? rowFromQuote(quote) : null
}

export async function listQuoteSources(
  tem: EntityManager,
  scope: { tenantId: string; organizationId: string | null },
): Promise<QuoteRow[]> {
  const quotes = await findWithDecryption(
    tem, SalesQuote,
    {
      tenantId: scope.tenantId,
      deletedAt: null,
      ...(scope.organizationId ? { organizationId: scope.organizationId } : {}),
    },
    { orderBy: { createdAt: 'desc' }, limit: 25 },
    { tenantId: scope.tenantId },
  )
  return quotes.map(rowFromQuote)
}

/** Invoices for the preview picker — the quote list alone left the picker blank when an invoice was open. */
export async function listInvoiceSources(
  tem: EntityManager,
  scope: { tenantId: string; organizationId: string | null },
): Promise<QuoteRow[]> {
  const invoices = await findWithDecryption(
    tem, SalesInvoice,
    {
      tenantId: scope.tenantId,
      deletedAt: null,
      ...(scope.organizationId ? { organizationId: scope.organizationId } : {}),
    },
    { orderBy: { createdAt: 'desc' }, limit: 25 },
    { tenantId: scope.tenantId },
  )
  return invoices.map((invoice) => {
    const metadata = jsonRecord(invoice.metadata)
    return {
      id: invoice.id,
      kind: 'invoice',
      quote_number: invoice.invoiceNumber,
      issue_date: isoDate(invoice.issueDate ?? invoice.createdAt),
      customer_snapshot: jsonRecord(metadata.customerSnapshot),
    }
  })
}

async function loadQuoteLines(tem: EntityManager, quoteId: string): Promise<QuoteRow[]> {
  const lines = await findWithDecryption(
    tem, SalesQuoteLine,
    { quote: quoteId, deletedAt: null },
    { orderBy: { lineNumber: 'asc' } },
  )
  return lines.map((line) => ({
    name: line.name ?? null,
    description: line.description ?? null,
    quantity: line.quantity,
    unit_price_net: line.unitPriceNet,
    total_net_amount: line.totalNetAmount,
    tax_rate: line.taxRate,
  }))
}

/**
 * The buyer's taxpayer id lives on the company record as the Thai custom field
 * Orva adds (`orva/ce.ts`). A tax invoice is legally deficient without it, so
 * its absence has to surface as a warning rather than an empty cell.
 *
 * `custom_field_values.record_id` is TEXT, hence the explicit cast — comparing
 * it to a uuid parameter is a hard Postgres error, not a silent mismatch.
 */
async function loadBuyerThaiIdentity(
  tem: EntityManager,
  customerEntityId: unknown,
): Promise<{ taxId: string | null; branch: string | null }> {
  if (!customerEntityId) return { taxId: null, branch: null }
  // The value can be keyed by either id: the company-profile custom entity
  // stores record_id = customer_companies.id, while the quote carries
  // customer_entity_id = customer_entities.id — so resolve the company id
  // through its entity link and accept a match on either.
  const rows = (await tem.execute(
    `select field_key, value_text from custom_field_values
     where field_key in ('th_tax_id', 'th_branch_code') and deleted_at is null
       and record_id in (
         ?::text,
         (select c.id::text from customer_companies c
          where c.entity_id = ?::uuid limit 1)
       )`,
    [String(customerEntityId), String(customerEntityId)],
  )) as QuoteRow[]
  const byKey = new Map(rows.map((row) => [String(row.field_key), row.value_text ? String(row.value_text) : null]))
  return { taxId: byKey.get('th_tax_id') ?? null, branch: byKey.get('th_branch_code') ?? null }
}

/**
 * The buyer, read from the sales customer snapshot.
 *
 * Sales normalizes the snapshot on every write into its canonical shape —
 * { customer: { displayName, primaryEmail, primaryPhone, ... }, contact: {...} }
 * — so a snapshot that starts out flat is restructured by the first update.
 * Reading only the top level printed "ลูกค้าทั่วไป" for a real customer the
 * moment anyone edited the quote. Mirror sales' own resolveCustomerName:
 * canonical shape first, flat legacy keys as fallback.
 */
function snapshotName(snapshot: Record<string, unknown>): string | null {
  const customer = snapshot.customer as Record<string, unknown> | undefined
  const contact = snapshot.contact as Record<string, unknown> | undefined
  if (typeof customer?.displayName === 'string' && customer.displayName) return customer.displayName
  const first = typeof contact?.firstName === 'string' ? contact.firstName : null
  const last = typeof contact?.lastName === 'string' ? contact.lastName : null
  const joined = [first, last].filter((part) => part && part.trim()).join(' ')
  if (joined) return joined
  if (typeof snapshot.displayName === 'string' && snapshot.displayName) return snapshot.displayName
  if (typeof snapshot.name === 'string' && snapshot.name) return snapshot.name
  return null
}

/** Composes one address line from the quote's billing address snapshot. */
function billingAddressText(row: QuoteRow): string | null {
  const billing = (row.billing_address_snapshot ?? {}) as Record<string, unknown>
  const parts = ['addressLine1', 'addressLine2', 'city', 'region', 'postalCode']
    .map((key) => (typeof billing[key] === 'string' ? (billing[key] as string).trim() : ''))
    .filter(Boolean)
  return parts.length ? parts.join(' ') : null
}

function partyFromSnapshot(row: QuoteRow, identity: { taxId: string | null; branch: string | null }): Party {
  const snapshot = (row.customer_snapshot ?? {}) as Record<string, unknown>
  const customer = snapshot.customer as Record<string, unknown> | undefined
  return {
    name: snapshotName(snapshot) ?? 'ลูกค้าทั่วไป',
    taxId: identity.taxId,
    branch: identity.branch,
    // the billing address the document was issued to; legacy flat keys after
    address:
      billingAddressText(row) ||
      (typeof snapshot.address === 'string' && snapshot.address) ||
      (typeof customer?.address === 'string' && customer.address) ||
      null,
    email:
      (typeof customer?.primaryEmail === 'string' && customer.primaryEmail) ||
      (typeof snapshot.primaryEmail === 'string' && snapshot.primaryEmail) ||
      null,
  }
}

/**
 * The one VAT rate every line agrees on, or null when they differ.
 *
 * A Thai tax invoice states a rate; stating one the lines do not share would
 * misdescribe the tax actually charged.
 */
function unanimousTaxRate(lines: QuoteRow[]): number | null {
  if (lines.length === 0) return null
  const rates = new Set(lines.map((line) => num(line.tax_rate)))
  return rates.size === 1 ? [...rates][0] : null
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
    // The rate the lines actually carry, never tax ÷ subtotal. Dividing yields
    // an effective rate that drifts whenever a discount lands on a different
    // base than the tax did — a real quote here printed "ภาษีมูลค่าเพิ่ม
    // 5.29%", which is not a rate Thai VAT has.
    taxRate: unanimousTaxRate(lines),
    taxAmount,
    grandTotal: num(row.grand_total_gross_amount),
    // comments arrive decrypted now that the quote is read through the
    // encryption helpers, so the operator's note prints on the sheet.
    note: typeof row.comments === 'string' && row.comments.trim() ? row.comments : null,
    paymentMethod: null,
    reference: (row.reference as DocumentReference | undefined) ?? null,
  }
}

/** Builds the printable document for one already-loaded quote row. */
export async function documentFromQuote(
  tem: EntityManager,
  args: { row: QuoteRow; type: DocumentType; template?: TemplateId; settings: DocumentSettings | null; brand?: string | null },
): Promise<PrintableDocument> {
  const billing = args.type === 'billing_note' ? await billingNoteLines(tem, args.row) : null
  const [lines, buyerIdentity, settings] = await Promise.all([
    billing
      ? Promise.resolve(billing.lines)
      : args.row.kind === 'credit_memo'
        ? loadCreditMemoLines(tem, String(args.row.id))
        : args.row.kind === 'invoice'
          ? loadInvoiceLines(tem, String(args.row.id))
          : loadQuoteLines(tem, String(args.row.id)),
    loadBuyerThaiIdentity(tem, args.row.customer_entity_id),
    brandedSettings(tem, args.settings, args.row.quote_number, args.brand),
  ])
  // a billing note has no VAT of its own: it totals the open invoices (gross)
  const row = billing
    ? { ...args.row, subtotal_net_amount: String(billing.total), discount_total_amount: '0', tax_total_amount: '0', grand_total_gross_amount: String(billing.total), valid_until: null, quote_number: `BN-${String(args.row.quote_number ?? '')}` }
    : args.row
  return buildPrintableDocument({
    type: args.type,
    template: args.template ?? templateFor(args.type, settings),
    seller: sellerFrom(settings),
    buyer: partyFromSnapshot(args.row, buyerIdentity),
    source: sourceFromQuote(row, lines),
    accentColor: settings?.brandColor ?? null,
    paymentDetails: settings?.paymentDetails ?? null,
    logoHeader: headerLogoFor(args.type, settings),
    logoFooter: settings?.logoFooter ?? null,
    terms: settings?.documentTerms ?? null,
  })
}

/**
 * The settings a document should print with: the legal entity's identity,
 * plus the brand's colour/logos/terms when the number belongs to a brand
 * series (MRV-… → Marventine). Default-series documents print unchanged.
 */
async function brandedSettings(
  tem: EntityManager,
  settings: DocumentSettings | null,
  number: unknown,
  brandCode?: string | null,
): Promise<DocumentSettings | null> {
  if (!settings) return settings
  const numbered = typeof number === 'string' && number.includes('-')
  if (!numbered && !brandCode) return settings
  const brands = await loadBrands(tem, { tenantId: settings.tenantId, organizationId: settings.organizationId })
  // the document's own number wins; the explicit code is for sheets that carry no brand yet
  const brand = (numbered ? brandForNumber(number, brands) : null)
    ?? (brandCode ? brands.find((b) => b.code === brandCode.toUpperCase()) ?? null : null)
  return settingsWithBrand(settings, brand)
}

/** The quotation may carry its own mark; billing documents share logoHeader. */
function headerLogoFor(type: DocumentType, settings: DocumentSettings | null): string | null {
  if (!settings) return null
  if (type === 'quotation') return settings.logoHeaderQuotation ?? settings.logoHeader ?? null
  return settings.logoHeader ?? null
}

/** Sample sheet for tenants with no sales records yet. */
/** Sample sheet, optionally dressed in a brand so a new brand can be checked. */
export async function sampleDocumentForBrand(
  tem: EntityManager,
  args: { type: DocumentType; template?: TemplateId; settings: DocumentSettings | null; brand?: string | null },
): Promise<PrintableDocument> {
  const settings = await brandedSettings(tem, args.settings, null, args.brand)
  return sampleDocument({ ...args, settings })
}

export function sampleDocument(args: {
  type: DocumentType
  template?: TemplateId
  settings: DocumentSettings | null
}): PrintableDocument {
  const payslip = args.type === 'payslip'
  return buildPrintableDocument({
    type: args.type,
    template: args.template ?? templateFor(args.type, args.settings),
    seller: sellerFrom(args.settings),
    buyer: payslip ? sampleEmployee() : sampleBuyer(),
    source: payslip ? samplePayslipSource() : sampleSource(),
    accentColor: args.settings?.brandColor ?? null,
    paymentDetails: args.settings?.paymentDetails ?? null,
    logoHeader: headerLogoFor(args.type, args.settings),
    logoFooter: args.settings?.logoFooter ?? null,
    terms: args.settings?.documentTerms ?? null,
  })
}

export function sourceOption(row: QuoteRow) {
  const snapshot = (row.customer_snapshot ?? {}) as Record<string, unknown>
  return {
    id: String(row.id),
    kind: row.kind === 'invoice' ? 'invoice' : 'quote',
    number: String(row.quote_number ?? ''),
    issueDate: isoDate(row.issue_date),
    customerName: snapshotName(snapshot),
  }
}

// ───────────────────────── credit / debit notes (ใบลดหนี้ / ใบเพิ่มหนี้) ─────

/**
 * A credit memo row shaped like the quote/invoice rows this file consumes,
 * plus the ป.82/2542 reference block. Debit notes reuse upstream's credit
 * memo entity with `metadata.noteKind = 'debit'` (upstream has no debit
 * memo); the sign of the correction lives in the ledger posting, the sheet
 * prints the difference as a positive amount under the right heading.
 */
export async function findCreditMemoById(
  tem: EntityManager,
  args: { creditMemoId: string; tenantId: string },
): Promise<QuoteRow | null> {
  const memo = await findOneWithDecryption(tem, SalesCreditMemo, { id: args.creditMemoId, deletedAt: null }, {}, { tenantId: args.tenantId })
  if (!memo || memo.tenantId !== args.tenantId) return null
  const metadata = jsonRecord(memo.metadata)
  const reference: DocumentReference = {
    invoiceNumber: String(metadata.originalInvoiceNumber ?? ''),
    invoiceDate: isoDate(metadata.originalInvoiceDate) ?? null,
    originalAmount: Number(metadata.originalTotal ?? 0),
    correctAmount: Number(metadata.correctTotal ?? 0),
    difference: Number(memo.grandTotalGrossAmount),
    reason: [metadata.reasonLabel, memo.reason].filter((v) => typeof v === 'string' && v.trim()).join(' — '),
  }
  return {
    id: memo.id,
    kind: 'credit_memo',
    note_kind: metadata.noteKind === 'debit' ? 'debit' : 'credit',
    quote_number: memo.creditMemoNumber,
    currency_code: memo.currencyCode,
    customer_entity_id: metadata.customerEntityId ?? null,
    customer_snapshot: jsonRecord(metadata.customerSnapshot),
    billing_address_snapshot: jsonRecord(metadata.billingAddressSnapshot),
    tenant_id: memo.tenantId,
    organization_id: memo.organizationId,
    issue_date: isoDate(memo.issueDate ?? memo.createdAt),
    valid_until: null,
    subtotal_net_amount: memo.subtotalNetAmount,
    discount_total_amount: '0',
    tax_total_amount: memo.taxTotalAmount,
    grand_total_gross_amount: memo.grandTotalGrossAmount,
    comments: null,
    reference,
  }
}

async function loadCreditMemoLines(tem: EntityManager, creditMemoId: string): Promise<QuoteRow[]> {
  const lines = await findWithDecryption(tem, SalesCreditMemoLine, { creditMemo: creditMemoId }, { orderBy: { lineNumber: 'asc' } })
  return lines.map((line) => ({
    name: line.name ?? null,
    description: line.description ?? null,
    quantity: line.quantity,
    unit_price_net: line.unitPriceNet,
    total_net_amount: line.totalNetAmount,
    tax_rate: line.taxRate,
  }))
}

/**
 * ใบวางบิล: every open invoice of the same customer as `row`, one line each,
 * gross amounts (no VAT split — the tax invoices already carry it).
 */
async function billingNoteLines(tem: EntityManager, row: QuoteRow): Promise<{ lines: QuoteRow[]; total: number }> {
  const customerEntityId = typeof row.customer_entity_id === 'string' ? row.customer_entity_id : null
  const rows = (await tem.execute(
    `select invoice_number, to_char(issue_date, 'YYYY-MM-DD') as issue_date, to_char(due_date, 'YYYY-MM-DD') as due_date,
            (grand_total_gross_amount - coalesce(paid_total_amount, 0))::text as remaining
     from sales_invoices
     where deleted_at is null and tenant_id = ?::uuid
       and (grand_total_gross_amount - coalesce(paid_total_amount, 0)) > 0.005
       and (id = ?::uuid or (?::text is not null and metadata->>'customerEntityId' = ?::text))
     order by issue_date, invoice_number`,
    [row.tenant_id, row.id, customerEntityId, customerEntityId],
  )) as Array<{ invoice_number: string; issue_date: string | null; due_date: string | null; remaining: string }>
  const lines = rows.map((r) => ({
    name: `ใบแจ้งหนี้ ${r.invoice_number}${r.issue_date ? ` ลงวันที่ ${r.issue_date}` : ''}${r.due_date ? ` ครบกำหนด ${r.due_date}` : ''}`,
    description: null,
    quantity: '1',
    unit_price_net: r.remaining,
    total_net_amount: r.remaining,
    tax_rate: null,
  }))
  return { lines, total: rows.reduce((s, r) => s + Number(r.remaining), 0) }
}

// ───────────────────────────────── สลิปเงินเดือน (payslip) ──────────────────

/**
 * One employee's line in a calculated payroll run, shaped like the rows this
 * file consumes. Read with scalar SQL and an explicit tenant filter — the
 * same seam this module already uses for sales tables; no cross-module ORM
 * relation is created.
 */
export async function findPayrollLineById(
  tem: EntityManager,
  args: { payrollLineId: string; tenantId: string },
): Promise<QuoteRow | null> {
  const rows = (await tem.execute(
    `select l.id, l.employee_no, l.employee_name,
            l.gross::text as gross, l.sso_employee::text as sso_employee, l.wht::text as wht, l.net::text as net,
            r.run_no, r.month_code, to_char(r.pay_date, 'YYYY-MM-DD') as pay_date,
            r.tenant_id, r.organization_id,
            e.employee_no as master_employee_no, to_char(e.hire_date, 'YYYY-MM-DD') as hire_date
     from orva_hr_payroll_lines l
     join orva_hr_payroll_runs r on r.id = l.run_id and r.deleted_at is null
     left join orva_hr_employees e on e.id = l.employee_id and e.deleted_at is null
     where l.id = ?::uuid and l.tenant_id = ?::uuid and l.deleted_at is null`,
    [args.payrollLineId, args.tenantId],
  )) as Array<Record<string, string | null>>
  const line = rows[0]
  if (!line) return null
  return {
    id: line.id,
    kind: 'payroll_line',
    quote_number: line.run_no ? `${line.run_no}-${line.employee_no ?? line.master_employee_no ?? ''}`.replace(/-$/, '') : String(line.id).slice(0, 8),
    currency_code: 'THB',
    customer_entity_id: null,
    customer_snapshot: {},
    billing_address_snapshot: {},
    tenant_id: line.tenant_id,
    organization_id: line.organization_id,
    issue_date: line.pay_date,
    valid_until: line.month_code,
    employee_name: line.employee_name,
    employee_no: line.employee_no ?? line.master_employee_no ?? null,
    hire_date: line.hire_date,
    month_code: line.month_code,
    gross: line.gross,
    sso_employee: line.sso_employee,
    wht: line.wht,
    net: line.net,
  }
}

/**
 * Payslip presentation: earnings first, then deductions as negative lines, so
 * the sheet's total is net pay. VAT plays no part.
 */
function sourceFromPayroll(row: QuoteRow): DocumentSource {
  const gross = num(row.gross)
  const sso = num(row.sso_employee)
  const wht = num(row.wht)
  const lines: DocumentLine[] = [
    { description: 'เงินเดือน', quantity: 1, unitPrice: gross, amount: gross },
  ]
  if (sso > 0) lines.push({ description: 'หัก ประกันสังคม (ลูกจ้าง)', quantity: 1, unitPrice: -sso, amount: -sso })
  if (wht > 0) lines.push({ description: 'หัก ภาษีเงินได้ ณ ที่จ่าย', quantity: 1, unitPrice: -wht, amount: -wht })
  return {
    number: String(row.quote_number ?? ''),
    issueDate: String(row.issue_date ?? ''),
    secondaryDate: typeof row.month_code === 'string' ? row.month_code : null,
    currencyCode: 'THB',
    lines,
    subtotal: gross,
    discount: 0,
    taxRate: null,
    taxAmount: 0,
    grandTotal: num(row.net),
    note: null,
    paymentMethod: null,
  }
}

/** Builds the payslip for one payroll line. */
export async function documentFromPayroll(
  tem: EntityManager,
  args: { row: QuoteRow; template?: TemplateId; settings: DocumentSettings | null },
): Promise<PrintableDocument> {
  return buildPrintableDocument({
    type: 'payslip',
    template: args.template ?? templateFor('payslip', args.settings),
    seller: sellerFrom(args.settings),
    // the employee is the counterparty on a payslip
    buyer: {
      name: String(args.row.employee_name ?? ''),
      taxId: null,
      branch: null,
      address: args.row.employee_no ? `รหัสพนักงาน ${args.row.employee_no}` : null,
      phone: null,
      email: null,
    },
    source: sourceFromPayroll(args.row),
    accentColor: args.settings?.brandColor ?? null,
    paymentDetails: null,
    logoHeader: args.settings?.logoHeader ?? null,
    logoFooter: args.settings?.logoFooter ?? null,
    terms: null,
  })
}
