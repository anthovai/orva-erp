# Orva Phase H — completing the departments: stock, marketing, projects, support

**Date**: 2026-09-10
**Status**: In progress — autonomous defaults applied (see Resolved assumptions); H1–H4 built (see Changelog), evidence being recorded

> Parent of four slices, written after the owner chose every remaining benchmark gap outside accounting (`2026-09-04-orva-department-benchmark.md` §2–4, §7) and added "เพิ่มฟังก์ชันให้ครบการทำงานของโมดูลด้วย". Order: H1 คลัง → H2 การตลาด → H3 โปรเจกต์ → H4 ซัพพอร์ต. Each slice leaves the app working and closes with its own spec-recorded evidence; the owner can stop after any slice.

## TLDR

Four department gaps become working features, each built on what the tenant already runs. **H1 Stock:** a reorder point per product raises "ใกล้หมด" on the home screen and the valuation page, and a Marketplace order file (Shopee / Lazada / TikTok export) imports as retail sales — each order row becomes the same ขายปลีก the screen creates today, idempotent on the marketplace order id. **H2 Marketing:** consent lives on the CRM contact (custom field + timestamp + source), a public unsubscribe link, and a broadcast composer that sends one `messages` email per consented contact. **H3 Projects:** an hourly rate per project (default from settings) turns logged minutes into cost and the project list into margin; an accepted quote issues its next งวด in one click. **H4 Support:** a small knowledge base (articles, portal-visible) and retainer invoices — a subscription with a customer and a quote issues its invoice on schedule.

Spoolman (3D-printer filament stock, MIT, Docker + REST) was asked about: not adopted — the tenant has no printer, and the lotion stock already lives in WMS + orva_stock. Recorded as an optional future provider, nothing more.

## Problem Statement

From the benchmark's remaining rows: no reorder point (only expiry warnings); marketplace orders are typed by hand although the retail sale already records the marketplace as its channel; no outbound marketing at all while a B2C brand is about to launch; project margin cannot be seen because hours have no rate; the "issue next งวด" is a derived row on the home screen, not an action; no place to publish answers for clients; no recurring invoice for a maintenance retainer even though the subscription register already tracks cycles.

## Goals

- **REQ-H1a** — A product can carry a reorder point; on-hand ≤ reorder point shows as "ใกล้หมด" on the home waiting card and on สินค้าคงเหลือและต้นทุน, with a link to สั่งซื้อ.
- **REQ-H1b** — A CSV/XLSX order export from Shopee, Lazada or TikTok imports as retail sales: preview → column mapping (presets per marketplace, editable) → each order creates one retail sale (invoice + payment + stock issue + COGS), skipping orders already imported (unique marketplace order id per tenant) and orders whose SKU or stock cannot be resolved, with a per-row result the owner can read.
- **REQ-H2a** — A contact (person or company) records marketing consent: yes/no, when, how (source); a public unsubscribe link withdraws it without a login.
- **REQ-H2b** — A broadcast (subject + body, Thai) goes to every consented contact as one `messages` email each, with a send log; recipients without consent are never sent to.
- **REQ-H3a** — A project (quote) has an hourly rate (default from a setting); the project list shows cost = minutes × rate and margin = billed − cost.
- **REQ-H3b** — From the project list, an accepted quote with an unissued งวด can issue that งวด's invoice in one click (through `issue-invoice`).
- **REQ-H4a** — Knowledge-base articles (title, body, tags, published) editable by staff, readable by signed-in customers in the portal, searchable by title.
- **REQ-H4b** — A subscription can be marked as a retainer with a customer + quote and an amount; on its renewal date the system issues the invoice through `issue-invoice`, advances the date, and shows the result.

## Non-goals

Marketplace API connectors (file import only); shipping labels; e-filing files; Spoolman; a full CMS (the KB is articles, not pages); approval flows (one person).

## Reuse and Ownership Map

| Capability | Reuse / app-own | Module | Seam |
|---|---|---|---|
| Reorder point | app-own custom field | `orva/ce.ts` on `catalog:catalog_product` (`reorder_point`, integer) | read by SQL on `custom_field_values` (the G3 precedent) |
| On-hand per variant | reuse | `orva_stock/lib/internal.ts` `lotsOnHand` | — |
| Marketplace import | app-own | `orva_stock/api/marketplace-import`, `components/MarketplaceImportPage`, entity `orva_stock_marketplace_imports` (order id unique per tenant) | each row → existing `POST /api/orva_stock/retail-sale` logic (shared function, not HTTP) |
| Consent | app-own custom fields | `orva/ce.ts` on **`customers:customer_entity`** (`marketing_consent` boolean, `marketing_consent_at` date, `marketing_consent_source` text) — defined once on the shared record, so the installed person AND company forms both render it (`entityIds={[customer_entity, <profile>]}`) and `custom_field_values.record_id = customer_entities.id` | read by SQL in `orva_marketing/lib/audience.ts`; written through the data engine (`setCustomFieldsIfAny`) by the consent route and the public unsubscribe route; token table `orva_marketing_unsubscribe_tokens` (one durable token per contact) |
| Broadcast | reuse `messages` compose (public, external) | new module `orva_marketing` (`api/broadcasts`, `components/BroadcastPage`) | `callInternal` → `POST /api/messages` per recipient; log rows |
| Rates & margin | app-own | `orva_documents`: entity `ProjectRate` (`orva_documents_project_rates`, unique per tenant+quote) + `default_hourly_rate` on `orva_documents_settings`; `PUT /api/orva_documents/project-rates` | minutes joined in `lib/projects.ts` by scalar quote id: `orva_tasking_projects` → `orva_time_project_links` → `staff_time_entries` (one query for the page, no cross-module ORM relation) |
| Issue next งวด | reuse | `orva_documents/api/issue-invoice` | row action on the projects page |
| Knowledge base | app-own | `orva_support` entity `SupportArticle` (`orva_support_articles`); `/backend/support/articles`; portal `frontend/[orgSlug]/portal/help` (`requireCustomerAuth`, nav entry) | `getCustomerAuthFromRequest`; scope from the session, never from the query |
| Retainer invoices | app-own on existing entity | `orva_support` subscriptions + `invoice_on_renewal`, `retainer_amount`, `last_invoice_id/number/at`; `lib/retainers.ts`; `GET/POST /api/orva_support/retainers`; worker `orva_support.retainer_scan` (daily 06:30) | the worker only raises `orva_support.retainer.due`; the POST calls `issue-invoice` through `callInternal` with the OWNER'S cookies, then rolls `renews_on` (see A8, superseded) |

## Resolved assumptions (autonomous defaults)

| ID | Assumption | Rationale | Flag |
|---|---|---|---|
| A1 | Reorder point is a product custom field (not a table) | one number per SKU; the CE precedent already carries FDA/shelf-life | — |
| A2 | Marketplace import = file upload with mapping presets, never an API connector | connectors need seller-center OAuth and break with each API change; the owner already downloads the order file | — |
| A3 | One order → one retail sale; multi-line orders → one sale with several lines; the marketplace's net payout (after fees) is NOT modelled — the sale records the listed price, fees are booked by the accountant from the marketplace statement | keeps the tax invoice honest (price the buyer paid) | ⚠ NEEDS HUMAN CONFIRMATION |
| A4 | Consent default is **no** for existing contacts; only explicit yes (imported list or form) counts | Thai PDPA | — |
| A5 | Broadcast sends through `messages` one email per contact, no scheduling, no templates beyond subject/body/Markdown | ≤ hundreds of contacts; the worker paces delivery | — |
| A6 | Hourly rate: one default (documents settings) + optional override per quote; cost = all logged minutes on the linked tasking project | one person, one rate; per-person rates when there is a second person | — |
| A7 | "Issue next งวด" defaults to the next unissued installment percent from the quote's installment plan when present, else asks for percent | the plan already exists on quotes | — |
| A8 | ~~The retainer worker issues invoices…~~ **SUPERSEDED at build time (2026-09-10).** The worker raises a notification and issues nothing; the owner presses ออกใบแจ้งหนี้ on the register and the invoice is minted with their own session through the same `issue-invoice` route a งวด uses | The flag said a worker minting invoices is a policy the owner has to set, and `orva_finance/workers/overdue-reminder-scan.ts` already established the house pattern for exactly this ("chasing a client is a judgement call, so the owner still presses send"). Issuing automatically later is a change to `workers/retainer-scan.ts` and nothing else | ⚠ OWNER DECIDES: say the word and the scan issues them unattended |
| A9 | Spoolman not integrated | no printer; WMS already holds the stock | — |

## Implementation Phases

### H1 — คลัง (REQ-H1a, H1b)
- `reorder_point` custom field; `lowStock` in `buildHomeOverview` + valuation page column/badge + home waiting row linking to `/backend/purchasing/orders/create`.
- `orva_stock_marketplace_imports` (tenant, org, marketplace, external_order_id unique, invoice_id, status, message, created_at) + migration with `orva_apply_rls()`.
- `lib/marketplaceFile.ts` (pure): CSV/XLSX rows → normalized orders using a mapping `{ orderId, sku, qty, unitPrice, orderDate, buyerName, status }`; presets `shopee`, `lazada`, `tiktok` (header aliases, Thai and English); status filter (only completed/shipped rows).
- `POST /api/orva_stock/marketplace-import/preview` (multipart file + marketplace → normalized rows + unresolved SKUs) and `POST /api/orva_stock/marketplace-import` (rows → sales, per-row result).
- Page `/backend/stock/marketplace-import` (Stock group): upload → preview table with mapping selects → import → results; history of imports.
- Tests: unit (parser + presets + idempotency helper), integration (preview + import with a seeded lot; re-import skips), smoke.

### H2 — การตลาด (REQ-H2a, H2b) — module `orva_marketing`
- CE consent fields on `customers:customer_entity` (see map); entities `orva_marketing_broadcasts` (status draft → sending → sent | partial | failed, counts), `orva_marketing_broadcast_recipients` (pending | sent | failed, `message_id`, `error`), `orva_marketing_unsubscribe_tokens` (unique per tenant+contact, unique token).
- Routes: `GET /api/orva_marketing/audience` (counts total/consented/reachable/noEmail/notConsented + contacts, in-memory search because names and addresses are encrypted at rest), `POST /api/orva_marketing/consent`, `GET/POST/PUT/DELETE /api/orva_marketing/broadcasts` (PUT/DELETE draft only, `updatedAt` version → 409), `POST /api/orva_marketing/broadcasts/send` (claims the draft as `sending`, reads the audience at that moment, one `callInternal('/api/messages')` per recipient with `visibility: public`, `bodyFormat: markdown`, `sendViaEmail: true`, `sourceEntityType: orva_marketing:broadcast`, footer with the recipient's own link; 412 when nobody can receive, 422 when not a draft), `GET /api/orva_marketing/broadcasts/recipients`, public `GET/POST /api/orva_marketing/unsubscribe` (token only, rate-limited `ORVA_UNSUBSCRIBE`, 404 for an unknown token).
- Pages: `/backend/marketing/broadcasts` (Marketing group, order 5, icon megaphone): 3 KPIs (จะได้รับอีเมล / ยังไม่ยินยอม / ยินยอมแต่ไม่มีอีเมล), tab ส่งข่าว (composer with subject/body, footer note, ส่งถึง n คน with confirm, บันทึกฉบับร่าง; history with status badge, counts, per-recipient list, edit/delete for drafts), tab ผู้รับและความยินยอม (every contact with email + consent switch = the CRM field). Public `/{orgSlug}/portal/unsubscribe/{token}`: names the contact, one button, done state, unknown-link state.
- Send runs inline in the request (A5: hundreds of contacts, not thousands); the messages worker paces delivery.
- Tests: 8 unit (recipient picking/dedupe, email normalisation, search, token, URL, footer); integration `orva_marketing/__integration__/broadcasts.spec.ts` (3 contacts → 2 in the send log + messages records carrying the link; stale version 409; re-send 422; public link without a session names the contact, the page's button withdraws consent, audience falls by one; screen renders KPIs/composer/history/audience without a client error); smoke walk picks the new page up from the module tree.

### H3 — โปรเจกต์ (REQ-H3a, H3b)
- `orva_documents_project_rates` (unique per tenant+quote, `hourly_rate`) + `default_hourly_rate` on `orva_documents_settings` (form field under ข้อมูลกิจการบนเอกสาร). `PUT /api/orva_documents/project-rates` sets or clears one project's rate (null removes the override; 404 for a quote that is not ours).
- `lib/projects.ts` gains `projectEconomics` (pure) and two more reads in `listProjects`: minutes per quote through tasking project → `orva_time_project_links` → `staff_time_entries`, and the per-quote rate rows. The API and the page carry `minutes`, `hourlyRate`, `rateSource` (project | default | none), `cost`, `marginBilled`, `marginProjected` — **null, never 0, when no rate is set**, so "no rate yet" cannot read as "made no money".
- Page: an เวลาที่ใช้ · ต้นทุน · กำไร column (hours, cost, projected and billed margin, the rate in force as a button that opens the rate dialog), row actions ออกใบแจ้งหนี้งวดถัดไป (only while something is unbilled) and ตั้งอัตราต่อชั่วโมงของโปรเจกต์นี้. `IssueInvoiceDialog` gained `defaultPercent` (the list passes 100 − billed%) and `onIssued` so the list refreshes instead of the dialog navigating on its own.
- Tests: 4 unit (`projectEconomics`: default vs override, null without a rate, satang rounding); integration `project-economics.spec.ts` (no rate → null; default → cost/margin; override wins and clears; 404; hours → cost when the timesheet mirror arrives, reported as skipped when it does not; next งวด issues and the margin follows; the screen renders the column); smoke.

### H4 — ซัพพอร์ต (REQ-H4a, H4b)
- `orva_support_articles` (title, slug unique among live rows, summary, body, tags[], is_published, position, updated_by). `lib/articles.ts` is the pure part: `slugify` (keeps Thai — combining marks are `\p{M}`, not `\p{L}`, so dropping them would turn วิธี into ว-ธ), `uniqueSlug`, `matchesSearch`, `excerpt`. Routes `GET/POST/PUT/DELETE /api/orva_support/articles` (staff, `updatedAt` version → 409, delete is soft and unpublishes) and `GET /api/orva_support/portal/articles` (customer session only; list with summaries, `?slug=` one article with its body).
- Pages: `/backend/support/articles` (list + editor, publish/unpublish, drafts filter, search) and the portal's `/{orgSlug}/portal/help` (`requireCustomerAuth`, nav entry ศูนย์ช่วยเหลือ, search, article view rendering the body as plain text with its own line breaks — never HTML from a stored string).
- Retainers: `invoice_on_renewal`, `retainer_amount`, `last_invoice_id/number/at` on the subscription register. `lib/retainers.ts` decides due-ness (active + toggle + customer + project + amount + date arrived + not already billed this cycle). `GET /api/orva_support/retainers` lists what is due; `POST` issues one through `issue-invoice` **with the caller's own session** and only then rolls `renews_on` one cycle on (an invoice that failed must not hide the retainer for a month). Worker `orva_support.retainer_scan` (daily 06:30, registered by `setup.seedDefaults`) raises `orva_support.retainer.due` and issues nothing. Page: a due-retainer band with ออกใบแจ้งหนี้ per line, a badge and a per-line toggle (only offered when the line has a customer and a project).
- Tests: 12 unit (slug/search/excerpt, due-ness and amount fallback); integration `articles-and-retainers.spec.ts` (draft invisible → published → portal route refuses a caller with no customer session; stale edit 409; duplicate title gets its own slug; screen renders. Retainer: due → invoice on the quote → renewal rolled → no longer due → second attempt 422; a line without a customer is never due); smoke.

Validation per slice: `yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test`, then `yarn test:integration:ephemeral` with the dev server stopped; browser check on the dev server for the changed screens.

## Risks

| Risk | Mitigation |
|---|---|
| Marketplace file formats drift | mapping presets are header aliases + an editable mapping UI; the preview shows unresolved columns before anything is written |
| Double import | unique (tenant, marketplace, external_order_id); re-import reports "skipped, already imported" |
| Broadcast to a non-consented contact | audience query filters on the consent field server-side; the recipient log records the consent snapshot |
| Worker-issued invoices | A8 flagged; the toggle is off by default per subscription |

## Changelog

| Date | Change |
|---|---|
| 2026-09-10 | Initial draft after the owner picked all four slices; H1 started |
| 2026-09-10 | **H1 built.** `reorder_point` custom field (installed on the tenant: fields +1); `orva_stock/lib/lowStock.ts` read by the valuation API/page (KPI, section with สั่งซื้อ link, row badge) and by the home waiting card via `buildHomeOverview`. Marketplace import: `lib/xlsxLite.ts` (own minimal .xlsx reader — zip + shared strings — because the app carries no spreadsheet dependency and every seller centre exports .xlsx), `lib/marketplaceFile.ts` (CSV/XLSX → orders; header-alias presets Shopee/Lazada/TikTok/custom; excluded statuses ยกเลิก/คืน/ค้างชำระ; พ.ศ. dates; line-total prices), `lib/marketplaceResolve.ts` (SKU → variant, FEFO lot allocation across lots, already-imported check), `lib/retailSale.ts` (the ขายปลีก route's body, shared), entity `orva_stock_marketplace_imports` + migration (unique per imported order), routes `marketplace-import/preview` (multipart) + `marketplace-import` (POST/GET), page `/backend/stock/marketplace-import` (3 steps: file → check/mapping → import; history). 18 unit tests (reader, CSV, presets, values, grouping). `useBrandCodes` moved to `orva_documents/components/queries.ts` so the two brand pickers share one key |
| 2026-09-10 | **H1 ephemeral run 1**: 50 passed, `marketplace-import.spec.ts` failed — preview answered an empty 500. Root cause: a JavaScript array bound to `= any(?::text[])` is expanded by the query builder into a list → `malformed array literal` (the trap `orva_tasking/lib/sql.ts` had documented, unindexed). Fix: `src/lib/pgArray.ts` `toPgTextArray` (quoted, escaped, one literal) used by `marketplaceResolve.ts` and the new `audience.ts`; preview/import routes now return the resolve error as JSON 500 instead of throwing. Lesson `.ai/lessons/raw-sql-array-binding-is-one-literal.md` (catalog → 16). Two earlier runs died with Docker Desktop (`ENOENT docker_engine`) — Docker came back with a **fresh data disk** (`D:\Docker\wsl\DockerDesktopWSL`, 2.8 GB) while the dev database's disk stayed at `D:\Docker\wsl\disk\docker_data.vhdx` (48 GB, intact); the dev Postgres is therefore down until the owner points Docker Desktop back at that folder — the ephemeral harness (testcontainers) is unaffected |
| 2026-09-10 | **H2 built.** Module `orva_marketing` (registered after `orva_support` in `src/modules.ts`; features `orva_marketing.view/manage`, employee = view). Consent moved to `customers:customer_entity` so one definition serves people and companies (map updated). Everything in the H2 section above; typecheck/lint/ds:check/unit green; ephemeral run in progress |
| 2026-09-10 | **H1 + H2 ephemeral green** (52 passed): the marketplace import and the broadcast both pass end to end. The unsubscribe page assertion had to stop matching Thai text — the reader arrives with no locale cookie, so the public page may render in English; it asserts by `data-testid` now |
| 2026-09-10 | **H3 built.** Everything in the H3 section above. A cleared hourly rate exposed a Zod trap worth keeping: in `z.union([z.coerce.number(), …, z.null()])` the coerce branch matches null and returns **0**, so clearing the company rate stored ฿0/hour and the projects list would have reported the whole quote as margin. Null and empty-string branches now come first in both nullable-number unions (documents settings, retainer amount) with a unit test each. Found by the integration spec, not by review |
| 2026-09-10 | **H4 built.** Everything in the H4 section above. **A8 superseded**: the retainer worker raises a notification and issues nothing; the owner presses ออกใบแจ้งหนี้ and the invoice is minted with their own session |
