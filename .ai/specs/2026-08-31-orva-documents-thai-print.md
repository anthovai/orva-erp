# Printable Thai business documents (orva_documents)

**Date**: 2026-08-31
**Status**: Shipped (Phases 1–2)

## TLDR

Sales today can only email a customer a *link* to a quote; there is no
document to look at, review, print or archive, and nothing that satisfies Thai
statutory form. `orva_documents` adds a rendering layer over the installed
sales records: four Thai document types (ใบเสนอราคา / ใบแจ้งหนี้ /
ใบกำกับภาษี / ใบเสร็จรับเงิน), three selectable templates, per-tenant seller
identity, and a backend preview screen that renders a real record — or sample
data when the tenant has none — at A4 with print CSS.

## Problem Statement

- A Thai tax invoice is legally invalid without the seller's and buyer's
  13-digit taxpayer ids, the branch designation (สำนักงานใหญ่ / 5-digit code),
  a VAT breakdown, and the document title in Thai. None of it exists today.
- `POST /api/sales/quotes/send` emails `APP_URL/quote/<token>` — a link. There
  is no artifact the customer can keep or the accountant can file.
- Staff cannot see what a customer will receive before sending it.

## Goals

- **REQ-001** — Render a sales record as any of the four Thai document types.
- **REQ-002** — Offer at least three visually distinct templates, selectable
  per document type and remembered per tenant/organization.
- **REQ-003** — Preview any document in the backoffice at A4 with a print
  stylesheet, using a real record or built-in sample data.
- **REQ-004** — Carry seller identity (name, taxpayer id, branch, address,
  contact) from tenant settings onto every document.

## Non-goals

Server-side PDF binaries (needs a new dependency — browser print covers the
need first), emailing the rendered document, e-Tax Invoice XML / RD
submission, digital signatures, credit-note documents, per-customer template
overrides.

## Domain Vocabulary and Business Rules

| Term | Rule |
|---|---|
| ใบเสนอราคา (quotation) | Pre-sale offer. Shows validity date. Not a tax document — no tax-invoice heading. |
| ใบแจ้งหนี้ (invoice) | Demand for payment. Shows due date. |
| ใบกำกับภาษี (tax invoice) | Statutory. MUST show both parties' taxpayer id + branch, VAT rate and VAT amount as separate lines, and the heading "ใบกำกับภาษี". |
| ใบกำกับภาษี/ใบเสร็จรับเงิน (receipt) | Issued as the combined form: proof of payment AND tax invoice on one sheet, which is how payment-on-issue works in Thai practice. Statutory, so it carries both parties' taxpayer ids, plus the paid date and method. |
| Branch | `สำนักงานใหญ่` for head office, otherwise a 5-digit code. Rendered verbatim. |
| Amount in words | Thai baht text (…บาทถ้วน / …สตางค์) on every document — expected by Thai accountants. |
| VAT | Derived from the record's own tax lines; the renderer never re-computes tax, it only presents what sales stored. |

## Architecture

```text
sales record (quote/invoice/order)  ─┐
orva_documents settings (seller)    ─┼─► buildPrintableDocument()  ─► PrintableDocument
sample fixture (no record)          ─┘        (pure, unit-tested)          │
                                                                            ▼
                                                         template registry (classic | modern | compact)
                                                                            │
                                              /backend/documents/preview ───┴──► print CSS (A4)
```

- **Pure core**: `buildPrintableDocument` maps a source record + seller
  settings + document type into a presentation-only structure. No IO, fully
  unit-tested — this is where the Thai rules live (heading text, which parties
  must carry a tax id, amount-in-words, VAT presentation).
- **Templates** are React components taking `PrintableDocument`. Adding a
  fourth template is one file plus a registry entry; nothing else changes.
- **No upstream edits**: sales data is read through its existing list API.

## Data Model

### `orva_documents:document_settings` (`orva_documents_settings`)
One row per tenant/organization.

| Field | Type | Notes |
|---|---|---|
| seller_name / seller_legal_name | text | printed header |
| seller_tax_id | text null | 13 digits |
| seller_branch | text null | default `สำนักงานใหญ่` |
| seller_address / seller_phone / seller_email | text null | contact block |
| template_quotation / template_invoice / template_tax_invoice / template_receipt | text | one of the registry ids, default `classic` |
| updated_at | timestamptz | optimistic locking |

RLS applied via `orva_apply_rls()`.

## API Contracts

| Method | Path | Gate | Purpose |
|---|---|---|---|
| GET | `/api/orva_documents/settings` | `orva_documents.view` | current seller identity + template choices |
| PUT | `/api/orva_documents/settings` | `orva_documents.manage` | upsert |
| GET | `/api/orva_documents/preview` | `orva_documents.view` | `?type=&template=&documentId=` → `PrintableDocument` JSON; falls back to sample data when `documentId` is absent |

## UI

`/backend/documents/preview` — document-type selector (4), template selector
(3), optional record picker, and the rendered A4 sheet. Print button uses the
browser print dialog against a dedicated `@media print` stylesheet.
`/backend/settings/documents` — seller identity + default template per type.

## Edge Cases

- No seller tax id → tax-invoice preview renders a visible warning strip
  instead of silently issuing an invalid document.
- No sales records yet → sample data, clearly labelled ตัวอย่าง.
- Buyer without a tax id → the buyer tax row prints `-`, and the tax-invoice
  type shows the same warning strip.
- Zero-VAT records → the VAT line renders `0.00`, never disappears.

## Implementation Phases

### Phase 1 (this change)
Settings entity + migration + CRUD, pure builder + Thai baht-text with tests,
three templates, preview page and print CSS, settings page, th/en i18n.

### Phase 2
Server-side PDF (`puppeteer-core`, prints the preview screen) and emailing the
document as an attachment — done. Token-scoped customer document view at
`/documents/<acceptance-token>` with its own public PDF — done.

**Decided against: attaching the document to the installed quote-send email.**
`POST /api/sales/quotes/send` composes and sends that mail inside the route —
`sendEmail` is a direct import, not a DI registration; the route emits no
event and runs no interceptor chain. There is no seam, so attaching would mean
overriding the whole route via `overrides.routes.api` and owning upstream's
guard, token-minting and status-transition logic through every future upgrade.
Not worth it: the link that email already carries now opens the document, with
print and PDF one click away. Revisit only if customers report that the link
is not enough.

## Status

Phases 1–2 shipped. Phase 3 in progress (2026-09-01).

### Phase 3 — invoices are real records with their own number series

User requirement from first real use: ใบแจ้งหนี้ and ใบเสนอราคา must be
SEPARATE record types with SEPARATE auto-running numbers in one scheme
(KK-QTN-{yyyy}{seq:3} / KK-INV-{yyyy}{seq:3}). Representing the invoice as a
second quote — the Phase 2 shortcut — put both in the ใบเสนอราคา list.

Decisions:
- **Carrier = upstream `sales_invoices`** (entity + CRUD + auto-numbering via
  salesDocumentNumberGenerator all exist; upstream ships no UI for them).
- SalesInvoice has no customer link (it is an order-billing artifact;
  order_id nullable). Standalone customer invoices carry their context in
  `metadata` — { quoteId, customerEntityId, customerSnapshot,
  billingAddressSnapshot, paidDate?, note? }. Orders enter later if the
  business ever uses them; no fake orders are minted.
- **Numbering**: quote format/sequence via upstream sales settings
  (configurable there already). Invoice format is NOT configurable upstream
  (command hardcodes the default), so `orva_documents_settings` gains
  `invoice_number_format`; issuance mints the number through
  POST /api/sales/document-numbers { kind: 'invoice', format } and passes it
  to the invoice create command.
- **Issue flow**: POST /api/orva_documents/issue-invoice { quoteId, amount |
  percent, description? } → creates the sales_invoice (7% VAT service line),
  copying customer context from the quote. Surfaced from the quote screen.
- **List UI**: /backend/sales/invoices (การขาย group) over /api/sales/invoices.
- **Renderer**: documentId resolution tries quote then invoice; invoice
  source allows invoice/tax_invoice/receipt types (a quotation cannot be
  printed from an invoice record). Receipt paid date = metadata.paidDate.
- **Data migration**: KK-INV-2026012 becomes a real invoice (paid in full via
  the KBank slip: 24,960 + 3% WHT 720); the quote-shaped copy is soft-deleted.

## Acceptance Criteria

- [ ] **AC-001** All four types render for a real record and for sample data.
- [ ] **AC-002** Switching template re-renders the same data in a visibly
      different layout, and the choice persists per tenant.
- [ ] **AC-003** Tax invoice shows both taxpayer ids, branch, VAT split, and
      warns when the seller id is missing.
- [ ] **AC-004** Baht-text conversion is unit-tested including สตางค์, ยี่สิบ,
      เอ็ด and millions.

## Changelog

| Date | Change |
|---|---|
| 2026-08-31 | Initial draft, ready for Phase 1 |
| 2026-08-31 | Phase 1 shipped |
| 2026-09-01 | Review fixes: no baht wording outside THB, VAT rate read from line data, receipt issued as the combined form, public PDF rate-limited. |
| 2026-08-31 | Phase 2 shipped: server-side PDF, email attachment on Orva's own send endpoint, customer document view. Attaching to upstream's quote-send email declined — no seam, not worth owning the route. |

### Phase 4 — e-Tax Invoice by Email (2026-09-03)

- Program rules (ETDA PDF/A-3 workshop + RD): sender = RD-registered
  address, buyer in TO (one), CC `csemail@etax.teda.th`, exactly one
  attachment, subject `[ddMMyyyy พ.ศ.][INV|RCT][number]`, attachment is
  PDF/A-3 with `ETDA-invoice.xml` (ขมธอ.3-2560 v2.0) embedded; XMP must carry
  `pdfaid:part=3`, `pdfaid:conformance=U`, `DocumentFileName`,
  `DocumentType`, `Version=2.0`.
- Implemented: `lib/etaxXml.ts` (TaxInvoice_CrossIndustryInvoice; T02/T03;
  TXID = taxid+branch), `lib/pdfA3.ts` (pdf-lib: attach XML AFRelationship
  /Data, catalog /AF, sRGB OutputIntent from a CC0 compact profile, XMP),
  `lib/etaxEmail.ts` (Resend with CC — upstream helper has none),
  `settings.etax_sender_email` gate, preview checkbox + "ดาวน์โหลด PDF/A-3".
- Open: full ISO 19005-3 conformance of Chromium output is unverified locally
  (validate the first real file with veraPDF / RD validator); XML not yet
  schema-validated against RD XMLSchemaV2 XSD; RD registration is the
  tenant's step.
