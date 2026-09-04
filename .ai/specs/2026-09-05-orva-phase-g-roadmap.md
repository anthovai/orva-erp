# Orva Phase G — the next six weeks, sequenced by where the owner's money and attention actually go

**Date**: 2026-09-05
**Status**: Draft (autonomous defaults applied — see Resolved assumptions; flip any ⚠ row and the plan re-sequences)

> Roadmap spec. It sequences and scopes the work; each phase that adds a new capability
> gets its own child spec when it starts (named per phase). Companion to
> `2026-09-04-orva-department-benchmark.md` (what is missing) and
> `2026-09-03-orva-for-kaiser-klowns-operating-model.md` (who this is for).

## TLDR

Kaiser Klowns is one person with a day job, running a project-based software business
today (quote → งวด → collect, customers withhold 3%) and preparing a lotion line
(Marventine) that does not exist as a product yet. Everything shipped so far (A–F) built
the *records*: documents, GL, payroll, stock valuation, tickets, subscriptions. Phase G
turns records into **attention savings**: the system tells the owner what to do next
and drafts it, instead of the owner opening screens to find out. Sequence: make the
data real (G0) → automate the cash cycle that pays the bills today (G1) → close the
support loop through the owner's actual inbox and add a morning brief (G2) → make
Marventine launch-ready only when a launch date exists (G3) → capture leads (G4).
Everything reuses installed capabilities (scheduler, messages/inbox_ops, notifications,
ai_assistant, document rails); the plan adds two small tables at most.

## Resolved assumptions (autonomous defaults)

| # | Question | Default taken | Why this default | Flip it if… |
|---|---|---|---|---|
| A1 | Does Kaiser have annual maintenance / retainer contracts today? | **No** → recurring invoices deferred to G1.4 (design only) | Only one real project exists (KK-QTN-2026011); building recurrence for zero contracts is speculative | you already bill any client on a schedule → promote G1.4 to G1 build ⚠ NEEDS HUMAN CONFIRMATION |
| A2 | Marventine: is there a launch or first-OEM-batch date? | **Unknown → G3 is gated**, prepared as a dry-run checklist, not built | "later, when the first batch exists" (operating-model spec §6); no product, no FDA number yet | a batch is ordered → G3 starts the week the PO is placed ⚠ NEEDS HUMAN CONFIRMATION |
| A3 | Support email-in: which mailbox do clients write to? | **kaiserklowns@gmail.com via `channel_gmail`** (one channel, owner connects it) | It is the company mail on every document; Gmail channel is installed; 0 channels configured today | clients write to a different address, or LINE OA matters more → swap the channel in G2.1 |
| A4 | Morning brief delivery surface | **In-app notification + email digest** at 07:30 Asia/Bangkok, weekdays | Both are installed (`notifications`, `messages`); push needs a device flow the owner has not set up | you want LINE Notify/push → add a channel adapter, same brief payload |
| A5 | Customer statement (Gap #3): per customer on demand, or monthly to all? | **On demand from the customer page + attached to reminders** | Two customers; monthly blasts are noise | you exceed ~10 active AR customers |
| A6 | PO to OEM: new purchase module or extend `orva_stock` receive? | **Extend receive with an `expected` (draft) state on the vendor bill — no PO module** | Upstream-first rule; bill→receive already exists; a PO is a bill you have not received against | you need multi-line partial receipts across many POs → child spec for a purchase module |
| A7 | Marketing broadcast | **Deferred until ≥ 20 opted-in contacts** | 2 customers today; consent + unsubscribe mechanics cost more than they return | you build a Marventine B2C list |

## Problem Statement

The owner now has correct books, correct documents and department screens — and has
to *look at them*. Concretely, on a given morning nothing tells them: a client accepted
the quote last night so งวด 1 should go out; งวด 2 is 9 days overdue; a client emailed a
bug to Gmail that never became a ticket; the domain for a client site lapses Friday.
Each of those is found by opening a screen (or not found at all). The user's own
framing on 2026-09-04: *"เช็คบั๊คก่อนที่ลูกค้าจะรู้ตัว"* — be told before the client is.

Evidence: home screen "waiting" card is the most-used surface (four questions);
Phase C's finance assistant was built precisely because the owner is alone; the Gmail
inbox is where clients actually write, and it is not connected (0 `communication_channels`).

Meanwhile the tenant still carries demo journals (JE-000001…, 30 rows) and 6 demo
parties, prod is missing `ORVA_PDF_BROWSER_PATH` / `RESEND_API_KEY`, and a new module's
role features must be granted by hand — so "real use" is blocked by hygiene, not
features.

## Overview and Success Measures

- **Primary outcome:** the owner handles a normal week from the morning brief and the
  assistant, opening at most 3 screens by hand. Target by end of G2: ≥ 80 % of
  cash-cycle actions (issue งวด, send reminder, record receipt) start from a prompt the
  system generated.
- **Leading indicators:** (1) days from quote acceptance to งวด 1 issued — target ≤ 1;
  (2) overdue invoices with no reminder sent — target 0 after 3 days; (3) client emails
  in Gmail with no ticket — target 0; (4) lapsed subscriptions — target 0.
- **Baseline:** (1) manual, unmeasured; (2) reminders exist only when the owner asks the
  assistant; (3) 100 % (no channel); (4) register empty. Measurement: the brief itself
  reports these four numbers daily, so the baseline is captured on day one of G2.
- **Market / product reference:** Odoo's "activities" + digest emails (adopted: a daily
  digest keyed to due dates; rejected: per-record activity chatter), FlowAccount's
  auto-reminder on overdue invoices (adopted: reminder cadence; rejected: sending
  without approval), Zendesk email-to-ticket (adopted: sender → customer match by domain;
  rejected: SLA engine, macros).

## Goals

- **REQ-001** — Tenant is production-real: no demo rows, all role features granted,
  prod env complete, RLS verified. (G0)
- **REQ-002** — Quote acceptance produces a next-action for งวด 1 without the owner
  noticing the acceptance first. (G1)
- **REQ-003** — An invoice overdue ≥ 3 days has a reminder drafted and queued for
  approval automatically; ≥ 10 days, a statement is attached. (G1)
- **REQ-004** — A customer statement (ใบแจ้งยอด) exists as a document type. (G1)
- **REQ-005** — A client email to the company mailbox becomes a ticket linked to the
  customer (and project when determinable); the staff reply goes back by email. (G2)
- **REQ-006** — A weekday morning brief lists money due, filings, tickets awaiting
  reply, renewals, and expiring quotes, each with a one-click action. (G2)
- **REQ-007** — The assistant can answer and act across Support/Projects/Subscriptions
  with the same approval gate as finance. (G2)
- **REQ-008** — When a Marventine batch is ordered, the path OEM bill → expected
  receipt → lot with cost/expiry → retail sale → ใบกำกับภาษีอย่างย่อ → lot label is
  exercised end-to-end on a real product before the first customer sale. (G3, gated)
- **REQ-009** — A public lead form creates a deal with `lead_source` filled. (G4)

## Non-goals

- No SaaS/multi-tenant productisation work; no enterprise package (licensing rule).
- No SLA engine, ticket macros, or knowledge base.
- No marketplace connectors (Shopee/Lazada) — phase H, needs a product first.
- No e-filing file formats (ภ.พ.30 / ภ.ง.ด. RD text) — the accounting firm files.
- No PromptPay QR (declined 2026-09-04).
- No new registries: customers stay in `customers`, vendors in `orva_party`, staff in `staff`.

## Proposed Solution

Three mechanisms, all installed, do most of the work:

1. **Events → notifications → home "waiting" rows.** Upstream `sales` already emits on
   quote acceptance; a subscriber in `orva_documents` turns it into a `next_installment`
   notification and a waiting-card row with "ออกงวด 1" as the click-through.
2. **Scheduler → drafts, never sends.** A daily `scheduled_jobs` entry in `orva_finance`
   scans overdue invoices and lapsed/renewing subscriptions and creates *approval-gated*
   pending actions through the same `ai_pending_actions` path Phase C uses — the owner
   approves in one click; nothing leaves without them.
3. **Inbox → ticket.** `channel_gmail` + `inbox_ops` already turn mail into proposals; an
   `orva_support` proposal handler creates a ticket, matches the sender's domain against
   the customer's contacts, and links the project when the subject or thread carries a
   quote/invoice number.

The morning brief is a composition of data that already exists (`buildHomeOverview`,
tickets counts, subscriptions summary) rendered once a day into a notification and an
email — no new data, one new job.

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| Drafts + approval, never auto-send | one owner, irregular clients; a wrong reminder costs a relationship | FlowAccount-style auto-send | one bad send > many saved clicks; approval is one click anyway |
| Brief as notification + email digest, not a new dashboard | the owner reads mail on the phone during the day job | new "today" page | another screen to open is the problem being solved |
| Email-to-ticket via `inbox_ops` proposals | installed, already parses mail, has dead-letter handling | IMAP poller in `orva_support` | duplicates a mechanism; loses AI triage |
| Statement as an `orva_documents` type | print/PDF/email rails exist; brand-aware | report page only | clients need to *receive* it, not view it |
| PO = expected receipt on the vendor bill | upstream-first; `bill → receive` exists | purchase module | zero purchase history; revisit with data (A6) |
| Recurring invoices: design only | no retainers today (A1) | build now on `scheduled_jobs` | speculative; 1-day build when needed |
| Lead form on `portal` | installed public surface with tenant scoping | Google Form + Zapier | no `lead_source`, no deal link |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| **งวด (installment)** | an invoice whose `metadata.quoteId` points at the quote; งวด n = n-th by issue date | `sales_invoices` | none — derived |
| **Next-action** | a waiting-card row + notification with exactly one click-through; resolved when its predicate turns false | `notifications` (type per action) | stale rows re-evaluated on each brief |
| **Overdue** | `due_date < today` and `remaining > 0.005` | `sales_invoices` | — |
| **Reminder cadence** | first draft at +3 days, then every 7 days, max 3; each is a *draft* pending approval; approving sends via existing `send_payment_reminder` | `ai_pending_actions` + `orva_finance` job | no draft if one is pending; never two in flight |
| **Statement** | all open invoices + receipts for one customer as at a date; balance = Σ remaining | `orva_documents` type `statement` from AR open items | empty statement renders "ไม่มียอดค้าง" |
| **Ticket from email** | sender matched to `customer_entities` by exact email, else by domain of a company contact; unmatched → ticket with `customerEntityId = null` flagged "จับคู่ลูกค้า" | `inbox_emails` → `orva_support_tickets` | duplicate thread → reply appended, not new ticket |
| **Project link on ticket** | `quoteId` set when subject/body contains a known quote or invoice number; else the customer's single active project; else null | `orva_documents` projects | never guessed across customers |
| **Brief** | one message, weekdays 07:30 Asia/Bangkok, sections in fixed order (money in, tax, tickets, renewals, quotes); omitted sections when empty; "ไม่มีอะไรค้าง" if all empty | scheduler job `orva_finance.morning_brief` | job failure → notification "สรุปเช้านี้ล้มเหลว" to admin, never silent |
| **Expected receipt** | a vendor bill line with `expected_qty` and no lot yet; receiving creates the lot and clears it | `orva_stock` bill-lines (A6) | over-receipt blocked; under-receipt leaves remainder expected |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| Owner (admin) | approve drafts, receive brief, all screens | organization | `orva_finance.gl.view`, `orva_support.manage`, `orva_documents.manage`, `ai_assistant.*` |
| AI assistant (on behalf of owner) | read tools; write tools create `ai_pending_actions` only | caller's organization | inherits caller |
| Scheduler jobs | read tenant data; create pending actions + notifications | per tenant, iterating enabled tenants inside `withTenantRls` | system job, installed contract: `scheduler` |
| Client (no login) | accept quote via token; view statement via share token; email support | token-scoped | none |
| Public lead form visitor | create one deal | tenant from portal host | none; rate-limited |

`tenantId`/`organizationId` come from the session (`getAuthFromRequest` +
`resolveActiveOrganizationId`) on every API; scheduler jobs iterate tenants explicitly
and wrap each in `withTenantRls`. Fail closed on missing scope.

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| Quote acceptance event | reuse | `sales` | event subscriber in `orva_documents` | upstream emits it |
| Next-action rows | reuse | `notifications` + `orva_finance` home overview | notification types + waiting card | one place for "what is waiting" |
| Overdue scan / reminder drafts | app-own job, reuse send | `orva_finance` (job) + Phase C tools | `scheduled_jobs` → `ai_pending_actions` | approval gate exists |
| Customer statement | extend | `orva_documents` (new type `statement`) | AR open-items SQL already in `orva_finance/lib/reportQueries` | document rails |
| Email ingestion | reuse | `channel_gmail` + `inbox_ops` | proposal handler in `orva_support` | installed pipeline |
| Ticket ↔ email thread | app-own link | `orva_support` (`threadId` on ticket) | `channel_thread_mappings` id snapshot | reply routing |
| Morning brief | app-own job | `orva_finance` | scheduler → `notifications` + `messages` | composes existing data |
| Assistant tools | extend | `orva_finance/ai-tools` → new `orva_support/ai-tools` | `createAiApiOperationRunner` over existing routes | same approval gate |
| Expected receipt | extend | `orva_stock` bill-lines | field + state | upstream-first (A6) |
| Lot label | extend | `orva_documents` (type `lot_label`) | lot + product custom fields | print rails |
| Lead form | reuse | `portal` + `customers` deals | public route creating a deal with `lead_source` | installed surfaces |

## Architecture and Data Flow

```text
sales.quote.accepted ──▶ orva_documents subscriber ──▶ notifications(next_installment) ──▶ home waiting row ──▶ IssueInvoiceDialog(งวด 1)

scheduled_jobs (daily 06:30) ─▶ orva_finance.overdue_scan ─▶ ai_pending_actions(reminder draft, + statement ≥10d) ─▶ owner approves ─▶ send_payment_reminder
scheduled_jobs (weekdays 07:30) ─▶ orva_finance.morning_brief ─▶ notifications + messages(email digest)

Gmail ─▶ channel_gmail ─▶ inbox_emails ─▶ inbox_ops proposal ─▶ orva_support handler ─▶ orva_support_tickets(+threadId, customerEntityId, quoteId)
staff reply ─▶ orva_support replies ─▶ messages(send on thread) ─▶ client

portal /lead ─▶ customers.deal (lead_source, stage=new) ─▶ notifications(new_lead)
```

- **Module boundaries:** `orva_finance` owns time-based jobs (it already owns the home
  overview and the assistant pack); `orva_support` owns ticket↔thread; `orva_documents`
  owns any printable. No module imports another's entities — IDs, snapshots, raw SQL.
- **Extension points:** event subscribers, `scheduled_jobs`, `inbox_ops` proposal
  handlers, notification types, AI tool registration, document type registry.
- **Alternatives considered:** a single "orva_ops" module for jobs — rejected, jobs
  belong with the data they read.
- **Compatibility:** no change to existing API shapes; new notification types and
  document types are additive; `orva_support_tickets` gains nullable `thread_id`.

## User Journeys

### Journey J-001 — Acceptance to งวด 1 (REQ-002)

1. Client opens the acceptance link at night and accepts.
2. Subscriber creates notification `orva.next_installment` for the quote; the morning
   brief and the waiting card show "CC Tech ตอบรับใบเสนอราคาแล้ว — ออกงวด 1 (30 %)".
3. Owner clicks → `IssueInvoiceDialog` pre-filled with งวด 1 → invoice issued → the
   notification resolves (predicate: an invoice with this `quoteId` exists).
4. If the quote was already invoiced (owner did it manually), the predicate is false
   at creation and no row appears.

### Journey J-002 — Overdue reminder (REQ-003)

1. 06:30 job finds KK-INV-2026012 งวด 2 at +3 days, no pending reminder.
2. Creates `ai_pending_actions` "ส่งเตือนชำระ งวด 2 ถึง CC Tech" with the drafted Thai
   email (existing `draft_payment_reminder`).
3. Brief lists it; owner taps approve → sent via existing route; audit row written.
4. Rejecting marks the action declined; next draft only after 7 more days. Payment
   recorded in between → pending action auto-cancelled by the next scan.

### Journey J-003 — Client bug by email (REQ-005)

1. someone@cctech.co.th emails "หน้า login พัง" to kaiserklowns@gmail.com.
2. Channel ingests; proposal handler creates TCK-000007, kind `bug`, customer = CC Tech
   (domain match), project = KK-QTN-2026011 (their only active project), `threadId` set.
3. Owner replies from the ticket; reply goes out on the same Gmail thread.
4. Client replies again → appended as `author: customer` on the same ticket (thread
   mapping), status → `open` if it was `waiting_customer`.
5. Unknown sender → ticket with "จับคู่ลูกค้า" badge; owner picks the customer once.

### Journey J-004 — Morning brief (REQ-006)

1. 07:30 weekdays: notification + email "สรุปเช้า 5 ก.ย.": 1 งวดเกินกำหนด (25,680), ภ.พ.30
   ยื่นภายใน 15 ก.ย., 2 tickets ยังไม่ตอบ, โดเมน cctech.com ต่ออายุใน 6 วัน, 1 ใบเสนอราคา
   หมดอายุใน 3 วัน — each line a link.
2. Empty day → "ไม่มีอะไรค้างเช้านี้" (still sent, so silence means failure).

## UI and Interaction Contracts

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend` home (waiting card) | add rows: next งวด, reminders pending approval, tickets from email unmatched | `/api/orva_finance/home/overview` (+ fields) | existing `FourQuestions` | existing | existing | REQ-002/003/005 |
| `/backend/ai/pending` (installed) | approve/decline drafted reminders | `ai_pending_actions` | installed ai_assistant page | installed | installed | REQ-003 |
| `/backend/documents/preview?type=statement&customerId=…` | render / PDF / email statement | new type in preview route | existing preview page | existing | existing + "ไม่มียอดค้าง" | REQ-004 |
| `/backend/customers/companies/[id]` | row action "ใบแจ้งยอด" | injection widget | existing customer page | `RowActions` injection | — | REQ-004 |
| `/backend/support/tickets` | badge "จากอีเมล", "จับคู่ลูกค้า"; reply sends by email when `threadId` | existing page | existing | existing | + conflict on 409 | REQ-005 |
| `/portal/lead` (public) | short form → deal | new public route | `portal` pages | portal shell, `CrudForm`-equivalent public form | success, validation, rate-limited | REQ-009 |
| `/backend/stock/receive` | "expected" lines from vendor bill; receive against them | extend existing | existing | existing | + over-receipt error | REQ-008 |

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| Owner | unchanged (Sales · Marketing · Projects · Stock · Accounting · HR · Support) | waiting card gains rows; no new groups | brief link → action dialog → done (2 clicks) |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| Brief email | "ไม่มีอะไรค้างเช้านี้" | single column, phone-first | n/a |
| Statement | "ไม่มียอดค้าง ณ วันที่ …" | A4 print | n/a |
| Lead form | — | mobile-first; ≤ 5 fields | tab order, submit on Enter, errors announced |

### `/portal/lead` — Lead form

```text
┌──────────────────────────────────────────┐
│ ติดต่อ Kaiser Klowns                      │
│ ชื่อ* │ บริษัท │ อีเมล* │ โทร │ รู้จักเรามาจาก ▼ │
│ เล่าสั้นๆ ว่าต้องการอะไร (textarea)         │
│                              [ส่งข้อความ] │
└──────────────────────────────────────────┘
```

- **Behavior:** creates a `customers` deal (stage first) + person if new; `lead_source`
  from the select (same options as `orva/ce.ts`); honeypot + per-IP limit; success page.
- **Responsive and accessibility:** labels bound, error text announced, 44 px targets.
- **Localization:** `orva_documents.lead.*` th/en.
- **Design-system and theming:** portal tokens; brand mark from the active brand profile.

## Data Models

### `orva_support_tickets` (change)

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `thread_id` | text, nullable, indexed | tenant/org | no | set by the proposal handler; used to route replies; never edited by hand |
| `source` | text `manual` \| `email`, default `manual` | — | no | set at creation |

### `notifications` types (additive, no schema)

`orva.next_installment`, `orva.reminder_pending`, `orva.ticket_unmatched`,
`orva.morning_brief`, `orva.new_lead` — registered through the installed notification
type registry with th/en templates.

### `orva_stock` bill lines (change, G3 — child spec)

`expected_qty numeric(18,4) null`, `expected_on date null`. A line with `expected_qty`
and no lot is an expected receipt.

### No new tables in G0–G2.

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| subscriber | `sales.quote.accepted` → `orva_documents.onQuoteAccepted` | system | event payload (quoteId) | notification created if no invoice yet | idempotent by (type, quoteId) | REQ-002 |
| job | `orva_finance.overdue_scan` daily 06:30 | scheduler | — | `ai_pending_actions` rows | one pending per invoice; skip if paid | REQ-003 |
| job | `orva_finance.morning_brief` weekdays 07:30 | scheduler | — | notification + email | on failure: admin notification | REQ-006 |
| `GET` | `/api/orva_documents/preview?type=statement&customerId=&asOf=` | auth + `orva_documents.view` | uuid, date | HTML (existing rails) | 400/404 | REQ-004 |
| handler | `inbox_ops` proposal `orva_support.create_ticket` | system | inbox email id | ticket id; appends on known thread | duplicate thread → append | REQ-005 |
| `POST` | `/api/orva_support/replies` (extend) | `orva_support.manage` | + `sendEmail: boolean` | reply + outbound message id | 502 on channel failure, reply still saved, flagged | REQ-005 |
| tools | `orva_support.list_tickets`, `orva_support.reply_ticket` (confirm), `orva_support.list_renewals`, `orva_support.mark_renewed` (confirm), `orva_documents.list_projects` | assistant | tool schemas | via existing routes | approval gate | REQ-007 |
| `POST` | `/portal/api/lead` (public) | none; rate limit + honeypot | name, email, company?, phone?, source, message | 201 deal id (opaque) | 400/429 | REQ-009 |

All routes: per-method `metadata`, OpenAPI, scope from session; jobs iterate tenants
inside `withTenantRls`. No `makeCrudRoute` needed — nothing here is a new CRUD entity.

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| quote accepted | `sales` | `orva_documents` subscriber | `orva.next_installment` | idempotent on (quoteId); resolved when invoice exists |
| daily 06:30 | scheduler | `orva_finance.overdue_scan` | reminder drafts, statement attach ≥ 10 d | one pending per invoice; cadence 3/7/7; audit via `ai_pending_actions` |
| weekdays 07:30 | scheduler | `orva_finance.morning_brief` | notification + email | failure → admin notification; never silent |
| inbound email | `channel_gmail` | `inbox_ops` → `orva_support` handler | ticket create/append | dead-letter on parse failure (installed) |
| ticket reply with `sendEmail` | `orva_support` | `messages` | outbound mail on thread | reply saved first; send failure flagged on the reply |
| lead form | `portal` | `customers` | deal + `orva.new_lead` | rate-limited; duplicate email within 24 h → append note, no new deal |

## Edge Cases & Failure Scenarios

- Acceptance for a quote the owner already invoiced → no row (predicate false).
- Client pays between scan and approval → next scan cancels the pending reminder; an
  approved-but-unsent reminder re-checks `remaining` before sending.
- Two customers share an email domain (agency) → domain match yields >1 → unmatched
  badge, never a guess.
- Email thread mapping lost (client starts a new thread) → new ticket; owner can merge
  by setting `threadId` — G2 ships "merge into ticket" as a row action.
- Brief job runs but a section's query fails → section replaced by "ส่วนนี้โหลดไม่สำเร็จ",
  brief still sent, admin notified.
- Statement for a customer with encrypted name → resolved via `findWithDecryption`
  as elsewhere; never raw.
- Expected receipt over-received → 409 with the remaining quantity.
- Lead form spam → honeypot + 5/min/IP; never creates a company, only a person + deal.

## Risks & Impact Review

- **Blast radius:** additive. Existing screens gain rows/badges. One nullable column on
  tickets (G2), two on bill lines (G3). Rollback = disable the job / drop the column.
- **Sending on the owner's behalf:** every outbound (reminder, statement, ticket reply)
  is either explicitly clicked or approval-gated. The brief is the only unsolicited
  message and it goes to the owner.
- **Gmail connection:** OAuth grant is the owner's action (G2 blocker). Until then the
  handler is inert; nothing degrades.
- **Scheduler correctness:** timezone pinned to Asia/Bangkok; jobs are idempotent per
  day (brief) / per invoice (scan). Verified with `--today` override like the overview.
- **Data hygiene first:** G0 purge is irreversible on demo rows — run against a fresh
  `pg_dump` and confirm the demo predicate matches only JE-0000xx and the 6 demo parties.

## Phasing

| Phase | Outcome | Effort | Blocker / owner action | Exit gate |
|---|---|---|---|---|
| **G0 — Make it real** ✅ 2026-09-05 | clean tenant, grants, launch.json, upstream write-ups | done | remaining: Railway env + filing the issues | met: `verify-rls` 7/7, 0 demo rows, grants already in place |
| **G1 — Cash cycle on autopilot** | acceptance → งวด prompt; overdue → drafted reminders; statement doc; recurring designed | 4–5 days | none | J-001, J-002 pass on real quote with `--today` override |
| **G2 — The owner's inbox** | email → ticket → email; morning brief; assistant tools across departments | 5–6 days | owner connects Gmail (OAuth) | J-003, J-004 pass; brief received 3 consecutive weekdays |
| **G3 — Marventine launch readiness** (gated A2) | expected receipt, lot label, full dry-run | 4 days | first OEM batch ordered | dry-run checklist all green on a real SKU |
| **G4 — Leads** | portal lead form → deal | 1–2 days | none | test lead appears on pipeline with source |
| **G5 — deferred by assumption** | recurring invoices (A1), broadcast (A7), purchase module (A6) | — | flip the assumption | child spec |

## Implementation Plan

### Phase G0 — Make it real (REQ-001) — ✅ done 2026-09-05 except two owner actions

1. ✅ **Purge demo data** — it took **two** scripts, not one: `purge-verification-entries.mjs`
   (JE-000027…030 — four expense journals from the F0 expense screen, in duplicate pairs
   incl. "นายฟรีแลนซ์ ทดสอบ" — plus TCK-000001…004 and 2 replies) then
   `purge-demo-data.mjs` (24 journals/66 lines, RCT-000002, BILL-000001, 6 parties,
   3 staff teams + 6 members, the sample workflow, 36 notifications, ~65 soft-deleted
   rows across the database, 10 orphan customers, 87 orphan custom-field values;
   renumbered JE-000010→JE-000001, JE-000011→JE-000002; reset sequences; fixed the
   RCT-000001 bank reference). Either order is safe — the second script's
   `where next_value > 27` guard means the journal sequence lands on 3 both ways.
   Backup first: `C:\Users\aidev\orva-backups\orva_erp-20260905-002936.dump`
   (custom format, verified with `pg_restore --list`: 2651 TOC entries, 334 tables).
   **Result:** 2 journals, TB 51,360.00 = 51,360.00 (diff 0.00), 0 demo rows, 0 parties,
   0 notifications, 0 tickets, 2 real customers; KK-QTN-2026011 (85,600),
   KK-INV-2026012 (25,680), RCT-000001 (25,680 gross, 720 WHT, 24,960 cash) intact;
   sequences journal→3, ar_receipt→2, ap_bill→1, fa_asset→1, support_ticket→1.
   Home screen verified post-purge with no stale cache.
2. ✅ **Grant role features** — nothing to do. `orva_support.view/manage` were already
   granted to admin/employee/superadmin (the subscription register reuses them and adds
   no new feature id); older modules are covered by wildcards (`orva_finance.*` etc.).
   Only `operator` and `supervisor` lack them, which is intended.
3. ⏳ **Owner action — prod env**: set `ORVA_PDF_BROWSER_PATH`, `RESEND_API_KEY`
   (+ `RESEND_FROM_EMAIL` to send) on Railway; none of the three exists locally either,
   so PDF/email cannot be smoke-tested until then.
4. ✅ **Fixed `launch.json`** — `runtimeExecutable: yarn`, `runtimeArgs: ["dev"]`,
   `port: 3000`, `autoPort: false` (the port is pinned because `APP_URL=http://localhost:3000`
   backs email links, the portal and G2's OAuth callbacks). The file is gitignored, so
   this is per-machine setup, not a commit.
5. ⏳ **Owner action — file upstream issues**: write-ups ready in `.ai/upstream-issues.md`
   for the two real bugs. **#5790 has no surviving description** anywhere in the repo —
   it needs the owner's note or it gets dropped.
6. ✅ Gates: typecheck clean, lint 0 errors, 152 tests, `verify-rls` 7/7 PASS (266
   tables), `verify-finance` all PASS with no residue.

### Phase G1 — Cash cycle on autopilot (REQ-002, 003, 004) — child spec `2026-09-0x-orva-cash-cycle-automation.md`

1. **Notification types** — register `orva.next_installment`, `orva.reminder_pending`
   with th/en templates. Test: type resolves in the notifications registry.
2. **Acceptance subscriber** (`orva_documents/subscribers/quoteAccepted.ts`) — on
   `sales.quote.accepted`, if no invoice has `metadata.quoteId = id`, create the
   notification; waiting card renders it with click-through to `IssueInvoiceDialog`.
   Tests: unit (predicate), integration (emit event → row appears; issue invoice → row
   gone).
3. **Overdue scan job** (`orva_finance/jobs/overdueScan.ts`, `scheduled_jobs` 06:30) —
   pure `reminderCadence(invoice, pendingActions, today)` in `lib/` (tests: +3/+10/+17,
   max 3, paid cancels, one in flight); job creates drafts via the Phase C tool path.
   Integration: run with `--today` on KK-INV-2026012 → one pending action; approve →
   sent through existing route.
4. **Statement document** — `orva_documents` type `statement`: header (brand), customer,
   as-of, open invoices with due/remaining, receipts, balance; reuses AR open-items
   SQL from `reportQueries`; row action on the customer page; attached automatically
   by the scan at ≥ 10 days. Tests: render with 0 / n open items; snapshot HTML.
5. **Recurring invoices — design only** (A1): write the child spec section (`scheduled_jobs`
   creating a draft invoice from a template quote on a cadence, approval-gated). No code.
6. Gates + browser verification of J-001/J-002 in light/dark, narrow width.

### Phase G2 — The owner's inbox (REQ-005, 006, 007) — child spec `2026-09-1x-orva-support-inbox-and-brief.md`

1. **Owner action:** connect Gmail in `/backend/communication_channels` (OAuth). Until
   done, steps 2–4 are verified with a fixture email through `inbox_ops`.
2. **Ticket columns** — migration adding `thread_id`, `source` (ends with
   `orva_apply_rls()`); entity + validators; **restart dev server** (lesson).
3. **Proposal handler** `orva_support/inbox/createTicket.ts` — pure
   `matchCustomer(sender, contacts)` and `inferProject(text, projects)` in `lib/` with
   tests (exact email, domain, ambiguous domain → null, quote-number in subject, single
   active project, none); handler creates/appends tickets. Integration: fixture email →
   ticket; second email same thread → reply appended.
4. **Reply by email** — `POST /api/orva_support/replies` gains `sendEmail`; sends via
   `messages` on `thread_id`; reply saved before send; failure flagged. UI: checkbox
   default on when `thread_id` exists; badges "จากอีเมล", "จับคู่ลูกค้า"; row action
   "รวมเข้าเรื่อง…".
5. **Morning brief job** (`orva_finance/jobs/morningBrief.ts`, weekdays 07:30
   Asia/Bangkok) — pure `composeBrief(overview, tickets, subs, today)` with tests
   (section omission, empty day text, ordering); renders th email via document rails
   styling; sends notification + email; failure → admin notification. Integration: run
   with `--today`, assert one notification + one outbound message; idempotent on rerun.
6. **Assistant tools** — `orva_support/ai-tools/support-pack.ts`: `list_tickets`,
   `reply_ticket` (confirm-required), `list_renewals`, `mark_renewed` (confirm),
   `orva_documents.list_projects`; registered alongside the finance pack. Test: tool
   run creates `ai_pending_actions`, nothing mutates until approved.
7. Gates; brief received on 3 consecutive weekdays before closing the phase.

### Phase G3 — Marventine launch readiness (REQ-008) — gated on A2; child spec `orva-marventine-launch.md`

1. **Dry-run checklist** (write first, run before any code): create the real SKU with
   `th_fda_notification`, `shelf_life_months`, `product_brand = Marventine`; vendor bill
   from the OEM with input VAT; receive → lot with cost + expiry; valuation shows it;
   retail sale → ใบกำกับภาษีอย่างย่อ → COGS posted; home expiry alert fires with a
   backdated lot. Fix whatever breaks — that is the phase's real work.
2. **Expected receipt** on bill lines (`expected_qty`, `expected_on`; receive against;
   over-receipt 409); waiting card row "ของจาก OEM ที่ยังไม่รับ".
3. **Lot label** — `orva_documents` type `lot_label`: brand mark, product, FDA no., lot,
   MFG/EXP, net content; sheet layout for A4 label paper; printed from the lot row.
4. Gates + physical print test.

### Phase G4 — Leads (REQ-009)

1. Public route `/portal/lead` + `POST /portal/api/lead`: honeypot, 5/min/IP, creates
   person (if new) + deal with `lead_source`; `orva.new_lead` notification; th/en.
2. Integration: submit → deal on pipeline with source; second submit same email in 24 h
   → note appended, no duplicate deal.

## Traceability

| REQ | Phase | Surface adapted (reference module file) | Test oracle |
|---|---|---|---|
| REQ-001 | G0 | — (ops) | `verify-rls` PASS, demo count 0 |
| REQ-002 | G1.2 | `src/modules/example/subscribers/*.ts` (event subscriber) | integration: event → row → issue → gone |
| REQ-003 | G1.3 | `src/modules/example/jobs/*.ts` (scheduled job) | `reminderCadence` unit + `--today` integration |
| REQ-004 | G1.4 | `orva_documents` document type registry (app-owned) | render 0/n items snapshot |
| REQ-005 | G2.2–4 | `inbox_ops` proposal handler seam; `orva_support` api | fixture email → ticket → reply routed |
| REQ-006 | G2.5 | `src/modules/example/jobs/*.ts`; notification type registry | `composeBrief` unit; 1 notification + 1 message per day |
| REQ-007 | G2.6 | `orva_finance/ai-tools/kaiser-pack.ts` pattern | pending action created, no mutation pre-approval |
| REQ-008 | G3 | `orva_stock` bill-lines/receive routes; document type | dry-run checklist green |
| REQ-009 | G4 | `portal` public page + api | deal with `lead_source` on pipeline |

## Open Questions

None blocking — see **Resolved assumptions**; A1 and A2 carry ⚠ and change the order
of G1.5 / G3 if answered differently.
