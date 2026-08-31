# Printable Thai business documents (orva_documents)

**Date**: 2026-08-31
**Status**: Ready for implementation

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
| ใบเสร็จรับเงิน (receipt) | Proof of payment. Shows paid date and method. Commonly issued combined as "ใบกำกับภาษี/ใบเสร็จรับเงิน". |
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

### Phase 2 (later)
Attach the rendered document to the quote-send email; customer-facing invoice
view; server-side PDF (needs a dependency decision).

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
