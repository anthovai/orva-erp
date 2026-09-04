# Orva by department — benchmark against the market and the gap plan

Status: design + rolling implementation (2026-09-04). Companion to
`2026-09-03-orva-for-kaiser-klowns-operating-model.md` (phases A–E shipped).

Benchmarks used (from product knowledge, not a live audit): **Odoo 17 Community**,
**ERPNext v15**, **Dolibarr**, and the Thai SME cloud accounting pair **FlowAccount** /
**PEAK** (Thai statutory documents, e-Tax, ภ.พ.30/ภ.ง.ด. workflows). The bar is "what a
one-person Thai service + product company actually uses", not feature-count parity.

Legend: ✅ have · 🟡 partial · ❌ missing · ⏸ upstream has it, hidden on purpose

## 1. งานขาย (Sales)

| Capability | Benchmark | Orva | Plan |
|---|---|---|---|
| Quotation → acceptance link → invoice by installment (งวด) | Odoo/FlowAccount | ✅ | — |
| Tax invoice / receipt / abbreviated tax invoice, e-Tax by Email (PDF/A-3) | FlowAccount/PEAK | ✅ | — |
| **ใบลดหนี้ / ใบเพิ่มหนี้** (credit / debit note) with RD reason codes, referencing the original tax invoice, posting to GL + ภ.พ.30 | FlowAccount/PEAK (statutory) | ❌ | **Gap #1 — this phase** |
| **ใบวางบิล** (billing note) listing open invoices per customer | FlowAccount/PEAK | ❌ | Gap #2 — this phase (per customer) |
| ใบส่งของ / delivery note | all | ⏸ (sales_shipments upstream) | expose when Marventine ships parcels |
| Customer statement (ใบแจ้งยอด) | Odoo/ERPNext | ❌ | Gap #3 — from AR open items |
| Recurring invoices (annual maintenance) | Odoo/ERPNext | ❌ | phase F: recurring งวด from quote |
| PromptPay QR on invoice | FlowAccount/PEAK | ❌ | phase F: EMVCo QR from bank details |
| Price lists, products on quotes, discounts | Odoo | ✅ upstream | — |
| Sales orders / channels | Odoo | ⏸ | not the business |
| Deals pipeline / CRM | Odoo | ✅ upstream | keep; owner may drop later |
| Retail sale (POS-lite) | Odoo POS | ✅ (orva_stock) | — |

## 2. การตลาดและลูกค้า (Marketing)

| Capability | Benchmark | Orva | Plan |
|---|---|---|---|
| Unified inbox (email/LINE/Slack) | Odoo Discuss | ✅ upstream (messages, channels) | connect the LINE OA channel when available |
| AI proposals from inbound mail | — | ✅ upstream (inbox_ops) | — |
| Email campaigns / broadcast | Odoo Marketing | ❌ | phase F: broadcast to a customer segment through the messages module |
| Lead capture form → deal | Odoo Website | ❌ | phase F: public form on the portal creating a deal |
| Lead source / UTM on deals | Odoo | 🟡 (custom field) | add `lead_source` select on deals |
| Landing pages / CMS | Odoo Website | ⏸ (content module) | out of scope |
| Customer portal (see quotes/invoices, pay) | Odoo | 🟡 upstream customer_accounts | enable when a customer asks |

## 3. โปรเจกต์และงาน (Projects)

| Capability | Benchmark | Orva | Plan |
|---|---|---|---|
| Tasks, calendar, workflow user tasks | all | ✅ | — |
| **Timesheets + projects** | Odoo/ERPNext | ⏸ upstream staff | **exposed this phase under Projects** |
| Project = quote, milestones = งวด, profitability (billed − hours × rate) | Odoo Project | ❌ | Gap #4: project card on the quote (installments already listed there) + hours from timesheets |
| Kanban board | all | 🟡 (customer tasks) | later |
| Client acceptance → triggers next งวด invoice | — | 🟡 (acceptance link on quote) | later |

## 4. คลังสินค้า (Stock)

| Capability | Benchmark | Orva | Plan |
|---|---|---|---|
| Lots, expiry, balances, movements | Odoo Inventory | ✅ upstream wms | — |
| Cost per lot, valuation, COGS posting | Odoo | ✅ (orva_stock) | — |
| **Purchase order to OEM → bill → receive** | Odoo Purchase | ❌ (bill → receive only) | phase F: light PO in orva_stock |
| Reorder point / low-stock alert | Odoo | 🟡 (wms profiles, events) | surface on the home screen |
| Barcode / lot label printing (with FDA no.) | Odoo | ❌ | phase F: label sheet from lot + product fields |
| Marketplace order import (Shopee/Lazada/TikTok) | Odoo connectors | ❌ | phase G |
| Shipping labels (Flash/Kerry) | — | ⏸ shipping_carriers | phase G |

## 5. บัญชี (Accounting)

| Capability | Benchmark | Orva | Plan |
|---|---|---|---|
| GL, periods, journals, TB, statements, cash flow, FA, bank reco, AR/AP, VAT/WHT registers, 50 ทวิ, month pack | PEAK | ✅ | — |
| Credit/debit notes in books and ภ.พ.30 | PEAK | ❌ | Gap #1 (see Sales) |
| **Expense claims / petty cash** (เบิกจ่าย, ใบสำคัญจ่าย) | PEAK/Odoo Expenses | ❌ | Gap #5 — this phase: expense entry with receipt image → bill-less journal + WHT |
| Recurring journals | ERPNext | ❌ | later |
| ภ.พ.30 e-filing file (RD text format) | PEAK | 🟡 (CSV) | later |
| ภ.ง.ด.3/53 e-filing file + ภ.ง.ด.1 for payroll | PEAK | 🟡 | later, with HR |
| Corporate income tax estimate (ภ.ง.ด.51/50) | PEAK | ❌ | phase F: half-year estimate from P&L |
| Budget vs actual | Odoo/ERPNext | ❌ | later |
| Multi-currency | all | ⏸ | not needed |
| Attachments on journals (slip/receipt) | all | 🟡 (invoice slips) | with expense claims |

## 6. บุคคล (HR)

| Capability | Benchmark | Orva | Plan |
|---|---|---|---|
| Employees, payroll runs, ประกันสังคม, WHT | ERPNext HR | ✅ | — |
| **Leave / availability** | Odoo Time Off | ⏸ upstream staff | **exposed this phase under HR** |
| Payslip PDF + email | Odoo | ✅ 2026-09-04 | `payslip` document type: own sheet (earnings / deductions / net pay, signatures, confidentiality note), printed from a payroll line (`/backend/documents/preview?type=payslip&documentId=<line>`), linked per employee from the payroll run; print, PDF and email reuse the document rails |
| ภ.ง.ด.1/1ก, สปส.1-10 files | Thai payroll (e.g. HumanSoft) | ❌ | later |
| Attendance | Odoo | ❌ | not needed for one person |

## 7. IT Support

| Capability | Benchmark | Orva | Plan |
|---|---|---|---|
| Users, roles, API keys, devices, MFA, SSO, integrations, webhooks, system status, cache, telemetry, audit log, API docs | all | ✅ upstream | audit log + API docs exposed this phase |
| **Helpdesk / tickets for clients** (SLA, email-in, customer link) | Odoo Helpdesk / osTicket | ❌ | **Gap #7 — this phase (light)**: tickets on customer companies, status/priority, email-in later |
| Software & subscription register (licences, renewals, cost account 5700) | ITAM tools | ❌ | phase F: asset register reuse (FA) with renewal reminders on home |
| Client site uptime monitoring | Uptime Kuma | ❌ | out of scope (use Uptime Kuma) |
| Knowledge base | Odoo Knowledge | ❌ | later |

## This phase (F0) — in order (1–3 shipped 2026-09-04; 4–5 next)

1. Expose hidden upstream capabilities into the department groups: timesheets/projects → Projects, leave/availability → HR, audit log + API docs → IT Support.
2. ใบลดหนี้/ใบเพิ่มหนี้ on top of upstream `sales_credit_memos`: Orva create screen from an invoice (reason codes per ป.82/2542), Thai document template, GL posting (Dr revenue + Dr output VAT / Cr AR), included in ภ.พ.30 output register as negatives.
3. ใบวางบิล: billing note per customer from open invoices (document type, printable/e-mailable).
4. ✅ Expense claims (`/backend/ap/expenses`): date, payee + taxpayer id + document no., amount with VAT mode (none / inclusive / exclusive), withholding, category account, cash account, receipt image. Posts on save through `buildExpenseJournalLines`; the journal carries the detail in its new `metadata` column, and the ภ.พ.30 input register plus the ภ.ง.ด.3/53 register read it. The VAT and WHT report routes now call the shared `lib/reportQueries` instead of their own SQL copies, so screens, month pack and registers can no longer drift.
5. ✅ Support (`/backend/support/tickets`): tickets against customer companies with type/priority/status/due date, a reply thread (staff / customer / internal note), minutes logged per reply rolling up to the ticket, first-response and resolution stamps, transition-checked status machine with optimistic locking; queue sorted urgent → overdue → oldest with counts for open, awaiting-reply, overdue and hours logged.
   The **Support** group is now customer support only; internal admin pages (attachments, audit log, API docs, profile preferences, deal settings) went back to the settings panel where they belong.

Out of this phase (F/G): recurring invoices, PromptPay QR, purchase orders, labels, campaigns, e-filing formats, CIT estimate, marketplace import.

## Phase F — in progress

1. ✅ Payslip document (2026-09-04) — see HR above.
2. **PromptPay QR on invoices / billing notes** — blocked on one decision: the QR image needs a generator. `@types/qrcode` is already a devDependency but the runtime `qrcode` package is not installed, and adding a dependency is ask-first. The EMVCo payload (tags + CRC16) can be built and unit-tested with no dependency; only the raster/SVG needs the library.
3. Recurring invoices (annual maintenance → งวด on a schedule, via the `scheduler` module).
4. Purchase order to the OEM (draft → bill → receive, closing the loop orva_stock already has from bill onward).
5. Customer statement (ใบแจ้งยอด) from AR open items.
