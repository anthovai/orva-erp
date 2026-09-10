# Orva by department — benchmark against the market and the gap plan

Status: design + rolling implementation (2026-09-04; **reconciled against the code 2026-09-10** — every row below was checked by grep, not memory; the 2026-09-10 pass folded in Phase H, which closed the last department gaps outside accounting: broadcast §2, project margin §3, reorder point + marketplace import §4, knowledge base §7, and recurring/retainer invoices §1). Companion to
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
| **ใบลดหนี้ / ใบเพิ่มหนี้** (credit / debit note) with RD reason codes, referencing the original tax invoice, posting to GL + ภ.พ.30 | FlowAccount/PEAK (statutory) | ✅ | `orva_documents/api/notes` (RD codes C1–C9/D1–D9, ป.82/2542 reference block), posted through `financeBridge.postNote`, credit memos in the VAT register (`reportQueries`) |
| **ใบวางบิล** (billing note) listing open invoices per customer | FlowAccount/PEAK | ✅ | document type `billing_note`, row action on the invoices list |
| ใบส่งของ / delivery note | all | ✅ 2026-09-09 (B1–B2) | `delivery_note` document type printed from the invoice (upstream shipments need a sales order, which this profile hides). Prices hidden by default, delivery block, two dated signature lines, two counterparts, and the delivery date/carrier/tracking recorded from the invoices list with a conflict guard. No receiver name is stored — invoice metadata is plaintext at rest. Public link live 2026-09-09 (own token table, no prices, rotation); emailed PDF rides the existing send route |
| Customer statement (ใบแจ้งยอด) | Odoo/ERPNext | ✅ | document type `statement` (`asOf` date), billed − paid = closing balance |
| Recurring invoices (annual maintenance) | Odoo/ERPNext | ✅ 2026-09-10 | ค่าดูแลระบบ as a retainer on the subscription register (customer + quote + amount + toggle); a daily scan raises "ถึงกำหนดเรียกเก็บ" and the owner presses ออกใบแจ้งหนี้, which mints a real invoice through issue-invoice and rolls the cycle (Phase H4). Unattended issuing is a one-file change once the owner asks (A8) |
| PromptPay QR on invoice | FlowAccount/PEAK | 🚫 | built then declined by owner 2026-09-04 ("ไม่เอา QR") — reverted in d430d3c; do NOT rebuild |
| Price lists, products on quotes, discounts | Odoo | ✅ upstream | — |
| Sales orders / channels | Odoo | ⏸ | not the business |
| Deals pipeline / CRM | Odoo | ✅ upstream | keep; owner may drop later |
| Retail sale (POS-lite) | Odoo POS | ✅ (orva_stock) | — |

## 2. การตลาดและลูกค้า (Marketing)

| Capability | Benchmark | Orva | Plan |
|---|---|---|---|
| Unified inbox (email/LINE/Slack) | Odoo Discuss | ✅ upstream (messages, channels) | connect the LINE OA channel when available |
| AI proposals from inbound mail | — | ✅ upstream (inbox_ops) | — |
| Email campaigns / broadcast | Odoo Marketing | ✅ 2026-09-10 | `orva_marketing`: consent per contact (PDPA custom fields on the shared customer record), audience counts, composer, one `messages` email per consented contact with a per-recipient unsubscribe link and a send log; public unsubscribe page needs no login (Phase H2). No scheduling or templates (A5) |
| Lead capture form → deal | Odoo Website | ✅ 2026-09-05 (G4) | public form at `/[orgSlug]/portal/lead`; honeypot + 24h dedupe |
| **Enquiry actually reaches the owner** | Odoo activities | ✅ 2026-09-08 | the form was silent: it now raises `orva.lead.received` and the home waiting card counts enquiries still on the first pipeline stage within 30 days. No auto-reply — answering is a human act |
| Lead source / UTM on deals | Odoo | ✅ 2026-09-04 | `lead_source` (ช่องทางที่มา) select on deals via orva/ce.ts, filterable |
| Landing pages / CMS | Odoo Website | ⏸ (content module) | out of scope |
| Customer portal (see quotes/invoices, pay) | Odoo | 🟡 upstream customer_accounts | enable when a customer asks |

## 3. โปรเจกต์และงาน (Projects)

| Capability | Benchmark | Orva | Plan |
|---|---|---|---|
| Tasks, calendar, workflow user tasks | all | ✅ | — |
| **Timesheets + projects** | Odoo/ERPNext | ✅ | `orva_time` (project hours via interceptors on the installed timesheet) + โปรเจกต์ page; upstream staff screens stay hidden |
| Project = quote, milestones = งวด, profitability (billed − hours × rate) | Odoo Project | ✅ 2026-09-10 | โปรเจกต์ page: billed/paid % per quote, unpaid งวด, remaining, hours logged, and now cost + margin from an hourly rate (company default in document settings, optional per-project override); "ออกใบแจ้งหนี้งวดถัดไป" is a row action (Phase H3). No rate set = blank, never a zero margin |
| Kanban board | all | 🟡 (customer tasks) | later |
| Client acceptance → triggers next งวด invoice | — | 🟡 | G1 (2026-09-05): accepted quotes appear as a derived "issue งวด" row on the home screen; no event exists upstream to automate the issue itself |

## 4. คลังสินค้า (Stock)

| Capability | Benchmark | Orva | Plan |
|---|---|---|---|
| Lots, expiry, balances, movements | Odoo Inventory | ✅ upstream wms | — |
| Cost per lot, valuation, COGS posting | Odoo | ✅ (orva_stock) | — |
| **Purchase order to OEM → bill → receive** | Odoo Purchase | ✅ 2026-09-08 (A1–A4) | `orva_purchasing`: order → receive through orva_stock → link the bill finance raised. Three-way match complete (ordered / received / billed), over-receipt refused, over-billing warned. What is late and what is committed-but-unbilled now reach the home screen and a daily 06:30 notification without opening the module. Every screen and dialog walked by browser specs 2026-09-09 (TEST-010, 11 specs), which found and fixed empty dropdowns on the create form |
| Reorder point / low-stock alert | Odoo | ✅ 2026-09-10 | expiry alerts (≤90 วัน + expired) plus a per-product reorder point: on-hand across every lot ≤ the point shows "ใกล้หมด" on the home waiting card and on สินค้าคงเหลือ, linking to สั่งซื้อ (Phase H1a) |
| Barcode / lot label printing (with FDA no.) | Odoo | ✅ 2026-09-09 | `lot_label` document: A4 3 × 8, อย. no., LOT, MFG/EXP, EAN-13 (Code 39 fallback), brand mark; "พิมพ์ฉลาก" on every lot; physical print test is the owner's |
| Marketplace order import (Shopee/Lazada/TikTok) | Odoo connectors | ✅ 2026-09-10 | file import (CSV/.xlsx, own reader, no new dependency): header-alias presets per marketplace with an editable mapping, preview that writes nothing, then each order becomes the same ขายปลีก the counter makes (invoice + payment + FEFO stock issue + COGS), idempotent on the marketplace order id (Phase H1b). Fees/payout not modelled — A3 |
| Shipping labels (Flash/Kerry) | — | ⏸ shipping_carriers | phase G |

## 5. บัญชี (Accounting)

| Capability | Benchmark | Orva | Plan |
|---|---|---|---|
| GL, periods, journals, TB, statements, cash flow, FA, bank reco, AR/AP, VAT/WHT registers, 50 ทวิ, month pack | PEAK | ✅ | — |
| Credit/debit notes in books and ภ.พ.30 | PEAK | ✅ | see Sales — `postNote` + VAT register |
| **Expense claims / petty cash** (เบิกจ่าย, ใบสำคัญจ่าย) | PEAK/Odoo Expenses | ✅ | `ExpensesPage`: date, payee, net/VAT/WHT, category + cash account, receipt image attached to the journal; no approval step (one person) |
| Recurring journals | ERPNext | ❌ | later |
| ภ.พ.30 e-filing file (RD text format) | PEAK | 🟡 (CSV) | later |
| ภ.ง.ด.3/53 e-filing file + ภ.ง.ด.1 for payroll | PEAK | 🟡 | later, with HR |
| Corporate income tax estimate (ภ.ง.ด.51/50) | PEAK | ❌ | no code; P&L exists to derive it from |
| Budget vs actual | Odoo/ERPNext | ❌ | later |
| Multi-currency | all | ⏸ | not needed |
| Attachments on journals (slip/receipt) | all | ✅ | invoice payment slips and expense receipts ride `/api/attachments` after the journal exists |

## 6. บุคคล (HR)

| Capability | Benchmark | Orva | Plan |
|---|---|---|---|
| Employees, payroll runs, ประกันสังคม, WHT | ERPNext HR | ✅ | — |
| **Leave / availability** | Odoo Time Off | ⏸ upstream staff | hidden on purpose in `src/modules.ts` (one person); re-enable per tenant when there is a second |
| Payslip PDF + email | Odoo | ✅ 2026-09-04 | `payslip` document type: own sheet (earnings / deductions / net pay, signatures, confidentiality note), printed from a payroll line (`/backend/documents/preview?type=payslip&documentId=<line>`), linked per employee from the payroll run; print, PDF and email reuse the document rails |
| ภ.ง.ด.1/1ก, สปส.1-10 files | Thai payroll (e.g. HumanSoft) | ❌ | later |
| Attendance | Odoo | ❌ | not needed for one person |

## 7. IT Support

| Capability | Benchmark | Orva | Plan |
|---|---|---|---|
| Users, roles, API keys, devices, MFA, SSO, integrations, webhooks, system status, cache, telemetry, audit log, API docs | all | ✅ upstream | audit log + API docs exposed this phase |
| **Helpdesk / tickets for clients** (SLA, email-in, customer link) | Odoo Helpdesk / osTicket | ✅ | tickets on customer companies, status/priority, reply thread, minutes logged; linked to a project (`quoteId`) 2026-09-05 — the Projects page counts open tickets per project and links straight into the filtered queue, so a client's bugs surface next to their billing. Email-in later |
| Software & subscription register (licences, renewals, cost account 5700) | ITAM tools | ✅ 2026-09-05 | `/backend/support/subscriptions`: licence/domain/hosting/certificate with cycle, cost, renewal date, auto-renew flag, expense account, project link; "ต่ออายุแล้ว" rolls the date one cycle on (past lapsed dates roll forward to the future); yearly run-rate KPI; lapsed + ≤30-day counts on the home waiting card |
| Client site uptime monitoring | Uptime Kuma | ❌ | out of scope (use Uptime Kuma) |
| Knowledge base | Odoo Knowledge | ✅ 2026-09-10 | `orva_support_articles`: title, Thai slug, summary, body, tags, draft until published; published articles appear in ศูนย์ช่วยเหลือ in the customer portal, searchable, scoped to the customer's own session (Phase H4) |

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
2. 🚫 PromptPay QR — shipped in a3fc0aa, owner declined 2026-09-04 ("ไม่เอา QR"), reverted in d430d3c. Do not rebuild. Owner also redirected phase F: cover the OTHER departments (การตลาด / โปรเจกต์ / คลัง / Support), not more accounting documents.
3. **โปรเจกต์ — projects overview** (Gap #4, first slice): a หน้าโปรเจกต์ under the
   Projects group listing each quote as a project — customer, quote total, งวด issued
   (from `sales_invoices.metadata->>'quoteId'`), amount billed / paid / remaining,
   % progress, and a jump to the quote's installments widget to issue the next งวด.
   Hours × rate profitability comes later once timesheets carry a rate.
4. **การตลาด — `lead_source` select** on deals (custom field via `orva/ce.ts`) so
   ช่องทางที่มา is captured and filterable on the pipeline.
5. **คลัง — expiry / low-stock on the home screen**: the waiting card counts lots
   expiring within 90 days (Marventine shelf life) so the owner sees it without
   opening the stock pages.
6. ✅ **Projects ↔ Support link** (2026-09-05) — the answer to "how do we catch a bug
   before the client does". A ticket carries the `quoteId` of the project it belongs to
   (picker on the create form); the Projects page shows an open-issue count per project
   and links into `/backend/support/tickets?quoteId=…`. So a project row shows both what
   it owes us and what we owe it.
7. ✅ **Support — software & subscription register** (2026-09-05) — see IT Support above.
   Renewal maths live in `lib/subscriptions.ts` (pure, 14 tests): month-end clamping,
   roll-forward past today, per-cycle annualisation.
8. Everything after this is sequenced in **`2026-09-05-orva-phase-g-roadmap.md`**
   (G0 hygiene → G1 cash cycle → G2 owner's inbox + morning brief → G3 Marventine,
   gated on a batch date → G4 leads). Recurring invoices, PO module and broadcast are
   deferred there by explicit assumption (A1/A6/A7) — flip the assumption, not the plan.

### Note for whoever picks this up next

Adding an entity class needs the **dev server restarted** — the ORM metadata bundle
(`.mercato/generated/entities.generated.mjs`) is built at boot, and `yarn generate`
will not refresh it while the server holds the old copy in memory. Symptom:
`MetadataError: Metadata for entity X not found` on the first write, while reads that
use raw `tem.execute` SQL keep working. See `.ai/lessons.md` → module-data.
