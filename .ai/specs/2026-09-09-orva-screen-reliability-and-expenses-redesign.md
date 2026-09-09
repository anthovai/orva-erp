# Orva screens: one query key = one shape, and ค่าใช้จ่ายจ่ายสด that explains itself

**Date**: 2026-09-09
**Status**: Complete — Phase 1 and Phase 2 shipped 2026-09-10; unit gates and the ephemeral suite (47 specs) green; verified on the dev server against the real tenant

> Child of `2026-09-03-orva-finance-thai-tax.md` (the expenses screen shipped as an F0 gap in `ce3cbf2`) and of the reliability rule recorded in `orva-query-key-shape-trap` (2026-09-07). Written under the owner's standing instruction "อย่าให้มีปัญหาตามมาทีหลัง … เพราะเช็คไม่ดี" and today's report: "เช็คทุกหน้าจนกว่าจะรู้ว่าไม่ได้ error แบบนี้อีก และออกแบบ UI ใหม่ให้ใช้ง่ายขึ้นกว่านี้ ดูแล้วเข้าใจเลยว่าทำอะไร".

## TLDR

The expenses screen crashed for the owner with `allAccounts.filter is not a function`. Root cause: seven screens share the React Query key `orva_finance.accounts.all`; six cache the `{ items }` envelope from `fetchCrudList`, ExpensesPage caches the bare array — so after visiting ใบวางบิลผู้ขาย (or any of the six) and clicking ค่าใช้จ่ายจ่ายสด in the sidebar, the expenses screen reads the envelope. Direct URL loads never reproduce it, which is why the 2026-09-05 fix (`c002b83`) could not, and why that fix — unwrapping to an array — actually created the second half of the collision.

This spec (1) removes the class app-wide: every query key's first segment is defined in exactly one file (a shared hook in the owning module), enforced by a Jest test that scans the modules, plus a Playwright smoke that opens every Orva page and walks the whole sidebar forward and backward on client-side navigation; (2) redesigns ค่าใช้จ่ายจ่ายสด so a non-accountant sees the job and its outcome at first glance, without changing the API. Reuses `fetchCrudList`, the shared UI primitives, the ephemeral integration harness.

## Problem Statement

- 2026-09-09, owner: runtime TypeError `allAccounts.filter is not a function` at `orva_finance/components/ExpensesPage.tsx:65` (Next 16.3 dev). Reached by sidebar navigation.
- 2026-09-07: the same class on `orva_tasking.projects` (TasksPage vs ProjectListPage). Recorded as a memory, not as a test — so it recurred.
- Inventory today: 105 `useQuery` definitions in 53 Orva files; **12 first segments are defined in more than one file** (`orva_finance.accounts.all` ×7, `orva_finance.periods.open` ×6, `orva_party.vendor-roles` ×3, `orva_party.vendors` ×3, `orva_documents.projects.pick` ×3, `orva_tasking.labels` ×3, and six pairs). Only `accounts.all` differs in shape today; four groups differ in whether `scopeVersion` is in the key (an org switch leaves stale options); the rest are identical by luck, not by contract.
- The screen itself: a 12-field accounting form (หมวดค่าใช้จ่าย, จ่ายจากบัญชี, three VAT modes, หัก ณ ที่จ่าย + อัตรา) beside a raw table, no statement of what to do first, no explanation of the tax choices, the posting outcome visible only after saving. The owner is a developer, not an accountant, and the accounting firm receives the result.

## Overview and Success Measures

- **Primary outcome:** no Orva screen throws on first render or after client-side navigation from any other screen; the expenses screen is used without help text.
- **Leading indicators:** `queryKeyOwnership.test.ts` green; `screens-smoke.spec.ts` green in the ephemeral harness (every static page + sidebar walk both directions); the owner records a real expense end to end.
- **Baseline:** 12 shared segments, 1 known crash, 0 automated coverage of client-side navigation.
- **Market / product reference:** FreshBooks/Wave "Add expense" — one obvious form, tax as a yes/no question, category chosen by name; adopted: the question-first form and a live total; rejected: receipt OCR and vendor auto-creation (scope).

## Goals

- **REQ-001** — Every React Query key's first segment is defined in exactly one file across `src/modules/orva_*`; a Jest test fails the build otherwise.
- **REQ-002** — Every static Orva backend page renders on an empty tenant with a real session and no client-side error; the sidebar can be walked forward and backward by clicking with no screen throwing (Playwright, ephemeral harness).
- **REQ-003** — ค่าใช้จ่ายจ่ายสด: at first glance the screen states the job, the common case (receipt without VAT, paid from the bank) needs 4 inputs (วันที่ พร้อมค่าเริ่มต้นวันนี้, จ่ายให้ใคร, เท่าไหร่, ประเภท), the tax block appears only when the receipt is a tax invoice, and the posting result (ค่าใช้จ่าย / ภาษีซื้อ / หัก ณ ที่จ่าย / เงินออก) is visible before saving.
- **REQ-004** — The `POST /api/orva_finance/expenses` contract, the GL posting, and the VAT/WHT registers are unchanged.

## Non-goals

- Redesigning other screens (the audit's clarity notes are reported to the owner for prioritisation, not acted on here).
- Changing `fetchCrudList`, the CRUD factory, or upstream components.
- Receipt OCR, vendor records for cash payees, recurring expenses.

## Proposed Solution

**Phase 1 — reliability.** Move every shared query into one exported hook in the module that owns the data: `orva_finance/components/queries.ts` (`useActiveAccounts`, `useOpenPeriods`, `useAllPeriods`, `useGlSettings`), `orva_party/components/queries.ts` (`useVendors` — moved from purchasing's pickers, re-exported there), `orva_documents/components/queries.ts` (`useProjectOptions`), `orva_tasking/components/queries.ts` (`useLabels`, `useTaskProjects`, `usePortalProjects`), `orva_stock/components/VariantPicker.tsx` (`useVariantSearch`, imported by purchasing). Each hook owns its key, includes `scopeVersion`, returns the unwrapped array plus `isLoading`/`failed` (the purchasing pickers pattern). Consumers filter client-side (asset/expense accounts from the active chart) instead of minting per-filter keys. Two oracles: `src/lib/__tests__/queryKeyOwnership.test.ts` (scans `useQuery` blocks, resolves keys held in a variable, fails on any first segment in two files) and `src/modules/orva/__integration__/screens-smoke.spec.ts` (every static page by URL, then every sidebar link clicked forward and backward, failing on `pageerror`, console errors, or Next's error boundary).

**Phase 2 — the screen.** Redesigned per the design panel's synthesized brief (three proposals — task-first, plain-language, record-first — scored by owner/accountant/engineer judges). Contract below; the API stays.

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| One first segment → one file (shared hook), enforced by test | The key is a cache contract; a hook makes shape and params single-sourced and the rule mechanical | Allow shared keys when queryFns are textually identical | Generic type args and variable names differ across sites; identity check is fragile and silent |
| Hooks return the unwrapped array + `isLoading`/`failed` | What every consumer wants; `failed` keeps "no data" distinct from "lookup failed" (lesson `picker-pagesize-over-contract-empties-the-select`) | Return the `ListResponse` envelope | Consumers re-derive `.items ?? []` seven times; the envelope's paging fields are never used |
| One `useActiveAccounts()` for the whole active chart, filtered client-side by type | Removes four keys (`accounts.all/.asset/.expense/.options`); the chart is ≤100 rows (the list contract's max, already the cap today) | Keep per-type server filters with per-type keys | More keys to keep unique for no data-size benefit |
| Hooks live in the owning module; consumers import across modules | Owner of the route owns its cache contract; precedent `orva_tasking → orva_time` import | Duplicate hooks per consuming module | That is the current state and the bug |
| Smoke spec in `src/modules/orva/__integration__` | The only module that spans all Orva screens; `dependsOnModules` lists them so a trimmed install skips it | One smoke per module | Cannot walk cross-module navigation |
| Sidebar walk forward + backward | Covers every ordered pair of screens (what A leaves in cache, B must render on) | Adjacent pairs only | Misses A→…→B where the cache entry survives (gcTime 5 min) |
| Redesign scope = the expenses screen | The owner's complaint is about the screen he was on; the crash audit collects clarity notes for the rest | Redesign every screen now | Weeks of work; unasked for as a batch — reported instead |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| Query key first segment | The string literal at index 0 of a `useQuery` `queryKey`; identifies one cache contract | `queryKeyOwnership.test.ts` | Build fails listing both files |
| Active chart | GL accounts with `is_active = true`, sorted by code, ≤100 | `GET /api/orva_finance/gl/accounts?isActive=true` | `failed` → screen shows "โหลดผังบัญชีไม่สำเร็จ" not "no accounts" |
| ค่าใช้จ่ายจ่ายสด | Expense paid from cash/bank with no vendor bill; posts one journal (`metadata.source = 'orva_finance.expense'`) | `POST /api/orva_finance/expenses` | 400 with Thai reason (no open period, VAT/WHT account unset) |
| ใบกำกับภาษี (inclusive) | Receipt total includes 7% VAT; `net = amount / 1.07` | `splitInclusiveReceipt` | — |
| ใบกำกับภาษี (exclusive) | Receipt shows VAT separately; `vatAmount` typed | `expenseCreateSchema` | — |
| หัก ณ ที่จ่าย | Amount withheld from the payee; reduces cash out; feeds ภ.ง.ด.3/53 | journal metadata | needs `whtPayableAccountId` in AP settings |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| Owner / admin | view screen, record expense | organization | `orva_finance.ap.view` (page), `orva_finance.ap.manage` (POST) |

`tenantId`/`organizationId` come from the session (`getAuthFromRequest` + `resolveActiveOrganizationId`) — unchanged.

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| CRUD list fetch | reuse | `@open-mercato/ui` `fetchCrudList` | — | house helper, envelope shape |
| Accounts / periods / settings queries | app-own hooks | `orva_finance/components/queries.ts` | import | owner of the routes |
| Vendors query | app-own hook | `orva_party/components/queries.ts` | import (purchasing re-exports) | owner of parties |
| Screen chrome, fields, states | reuse | `Page`, `PageHeader`, `FormField`, `SegmentedControl`/`RadioField`, `Alert`, `EmptyState`, `SectionHeader`, `Button`, `Input` | — | design-system contract |
| Browser harness | reuse | `yarn test:integration:ephemeral` | — | production build, real session |

## Architecture and Data Flow

```text
Screen A (useActiveAccounts) ─┐
Screen B (useActiveAccounts) ─┼─ one key ['orva_finance.accounts.all', scopeVersion] → fetchCrudList → GET /api/orva_finance/gl/accounts
Screen C (useActiveAccounts) ─┘        cache holds ONE shape (AccountOption[]) whatever the navigation order

Jest queryKeyOwnership ── scans src/modules/orva_*/** ── fails on any first segment in two files
Playwright screens-smoke ── login → each page.tsx URL → sidebar links forward → backward ── fails on pageerror/console error/error boundary
```

- **Module boundaries:** hooks sit with the route owner; no cross-module ORM.
- **Extension points:** none; app-owned files only.
- **Compatibility:** all API routes unchanged; the key literal `orva_finance.accounts.all` keeps its name so `invalidateQueries` prefixes elsewhere still match.

## User Journeys

### Journey J-001 — Record a shop receipt (the common case)

1. Owner opens ค่าใช้จ่ายจ่ายสด from the sidebar (from any screen).
2. Reads at the top what the screen does and what to do first; today's date and the bank account are pre-filled.
3. Types จ่ายให้ใคร, เท่าไหร่, picks a plain-language ประเภท (expense account shown by name); the live strip shows เงินออก = amount.
4. Presses บันทึกและลงบัญชี (or Ctrl/Cmd+Enter); the row appears at the top of the month list with its journal number; the form clears for the next receipt; the receipt image, if attached, uploads after the journal exists.
5. Failure: no open period → Alert with the month named and a link to งวดบัญชี; VAT/WHT account unset → Alert linking to AP settings; network → flash, input preserved.

### Journey J-002 — Record a supplier tax invoice with withholding

1. Same start; answers "ใบเสร็จนี้เป็นใบกำกับภาษีไหม" → yes; the tax block opens: รวม/แยก VAT, เลขผู้เสียภาษีผู้ขาย, เลขที่ใบกำกับภาษี.
2. Ticks หักภาษี ณ ที่จ่าย → rate (default 3%) and the amount computed, editable.
3. Live strip: ค่าใช้จ่าย · ภาษีซื้อ · หัก ณ ที่จ่าย · เงินออกจากบัญชี — the same four numbers the journal will carry.

## UI and Interaction Contracts

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/ap/expenses` | record an expense; review the month | `GET/POST /api/orva_finance/expenses`, `useActiveAccounts`, `useOpenPeriods`, `GET /api/orva_finance/ap/settings`, `POST /api/attachments` | `orva_finance/components/ReceiptCreateForm.tsx`, `orva_stock/components/StockValuationPage.tsx` | `Page`, `PageHeader`, `PageBody`, `FormField`, `Input`, `Button`, `SegmentedControl`/`RadioField`, `SwitchField`, `Alert`, `EmptyState`, `SectionHeader` | loading, empty month, error, saving, saved, upload failed, chart failed, no open period, tax accounts unset | REQ-003, REQ-004 |

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| Owner | บัญชี → ค่าใช้จ่ายจ่ายสด (order 125, unchanged) | none | login → sidebar → form → บันทึก (≤3 clicks) |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| month list | "ยังไม่มีค่าใช้จ่ายในเดือนนี้ — บันทึกใบเสร็จแรกจากฟอร์มด้านบน/ซ้าย" | form above list at <1024px; two columns from lg | first field focused; Ctrl/Cmd+Enter submits; Escape clears the form |

### `/backend/ap/expenses` — ค่าใช้จ่ายจ่ายสด

```text
┌ ค่าใช้จ่ายจ่ายสด ─────────────────────────────────────────────────────────────┐
│ มีใบเสร็จอยู่ในมือ? กรอก 3 ขั้น — ระบบลงบัญชีให้ทันที และส่งเข้ารายงานภาษี…ให้เอง │
├──────────────── form (lg:col-span-3) ────────────────┬─ preview (lg:col-span-2, sticky) ─┤
│ ขั้นที่ 1  ใบเสร็จนี้คืออะไร                            │ เมื่อกดบันทึก ระบบจะลงบัญชีแบบนี้     │
│  จ่ายให้ใคร* │ วันที่บนใบเสร็จ* (วันนี้)                 │ ค่าใช้จ่าย · {หมวด}         100.00 │
│  เป็นค่าอะไร* (Select: ชื่อก่อน รหัสจาง)                │ ภาษีซื้อ · เข้า ภ.พ.30        7.00 │
│  ซื้ออะไร/ใช้ทำอะไร │ รูปใบเสร็จ                        │ หัก ณ ที่จ่าย 3% · ภ.ง.ด.3/53 −3.00 │
│ ขั้นที่ 2  จ่ายเท่าไหร่ จ่ายจากไหน                        │ ─────────────────────────────── │
│  ยอดรวมทั้งสิ้นที่จ่าย* │ จ่ายจาก* (Segmented ≤3 / Select) │ เงินออกจาก {บัญชี}   ══104.00══ │
│ ขั้นที่ 3  เรื่องภาษี                                    │ [   บันทึกและลงบัญชี   ]         │
│  (•) ใบเสร็จธรรมดา/อย่างย่อ  ( ) ใบกำกับภาษีเต็มรูป        │ Enter หรือ Ctrl+Enter · ล้างฟอร์ม   │
│     ┆ เลขผู้เสียภาษี* เลขที่ใบกำกับ* · VAT ที่แยก… กรอกตามใบ │ Alert success/warning/error      │
│  [switch] หักภาษี ณ ที่จ่ายจากยอดนี้ ┆ อัตรา 1|2|3|5|อื่น · จำนวน │                                 │
├──────────────────────── รายการเดือนนี้ (n) [เดือน] ดู ภ.พ.30 · ดูทะเบียนหัก ณ ที่จ่าย ┤
│ ค่าใช้จ่ายรวม │ ภาษีซื้อรวม │ หัก ณ ที่จ่ายรวม │ ══เงินออกรวม══                      │
│ วันที่ │ จ่ายให้ (เลขที่ · โน้ต) │ หมวด │ ค่าใช้จ่าย │ ภาษีซื้อ │ หัก ณ ที่จ่าย │ เงินออก │ สมุดรายวัน │
└──────────────────────────────────────────────────────────────────────────────┘
```

Synthesized from the two proposals the design panel returned (task-first won the structure; the month totals strip, remembered bank account, WHT presets and helper texts are the record-first proposal's grafts). Fixed points: (a) a one-line statement of the job under the title; (b) common case = 4 inputs with defaults (today, bank account remembered from last use, ไม่มี VAT); (c) tax block behind one plain question; (d) live posting strip always visible; (e) list shows month totals and a journal link per row; (f) preconditions surfaced before save (open period for the chosen date, AP tax accounts when needed).

- **Behavior:** validation inline with the first invalid field focused; duplicate submit disabled; input preserved on server error.
- **Responsive and accessibility:** labels on every control; the file input labelled; contrast via tokens; 375px single column.
- **Localization:** `orva_finance.expense.*` keys in th/en.
- **Design-system and theming:** semantic tokens only; money uses `tabular-nums`; the double rule (เส้นคู่บัญชี) only on the month total.

## Data Models

N/A — no schema change. (`orva_gl_journals.metadata.source = 'orva_finance.expense'` continues to identify the rows.)

## API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| `GET` | `/api/orva_finance/expenses?month=YYYY-MM` | auth + `orva_finance.ap.view` | `expenseListSchema` | `{ items }` | 400/401 | REQ-004 (unchanged) |
| `POST` | `/api/orva_finance/expenses` | auth + `orva_finance.ap.manage` | `expenseCreateSchema` | `{ ok, journalId, journalNo, net, vat, wht, paid }` | 400 Thai reason / 401 | REQ-004 (unchanged) |

Internal (not public) contracts: the hooks listed in Proposed Solution. Their keys: `orva_finance.accounts.all`, `orva_finance.periods.open`, `orva_finance.periods.all`, `orva_finance.gl.settings`, `orva_party.vendors` (+ `orva_party.vendor-roles`), `orva_documents.projects.pick`, `orva_tasking.labels`, `orva_tasking.projects`, `orva_tasking.portal.projects`, `catalog.variants.pick`.

## Events, Jobs, Notifications, and Cross-Module Flows

N/A — no new events; `invalidateQueries(['orva_finance.expenses'])` and `['orva_finance.journals']` after save as today.

## Security, Privacy, and Compliance

- **Authorization:** unchanged feature gates.
- **Tenant isolation:** routes unchanged (`withTenantRls`).
- **Sensitive data:** none new; payee tax id stays in journal metadata as today.
- **Abuse and failure modes:** none new.

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | unit (Jest) | source tree | scan `useQuery` definitions | no first segment in two files; keys held in variables resolved | REQ-001 |
| TEST-002 | integration (browser) | ephemeral tenant, admin session, Thai | `goto` every static Orva page | no pageerror / console error / error boundary | REQ-002 |
| TEST-003 | integration (browser) | same | click every sidebar link forward, then backward | same, per link, both passes | REQ-002 |
| TEST-004 | integration (browser) | expense + cash accounts, open period via API | open ค่าใช้จ่ายจ่ายสด; record a plain receipt; record a tax invoice with 3% WHT | live strip math; rows appear with journal numbers; `GET /expenses` returns both; journals posted | REQ-003, REQ-004 |

## Implementation Phases

### Phase 1 — Reliability: one key, one shape, two oracles

- **Depends on:** none
- **Outcome:** the crash class cannot come back unnoticed; the known collision is gone
- **Deliverables:** `queries.ts` hooks (finance, party, documents, tasking), `useVariantSearch` export in stock, consumers switched (≈20 files), `queryKeyOwnership.test.ts`, `screens-smoke.spec.ts` + `orva/__integration__/meta.ts`
- **Independent slices:** hooks per module (4 commits or 1)
- **Requirements closed:** REQ-001, REQ-002
- **Tests:** TEST-001, TEST-002, TEST-003
- **Validation:** `yarn typecheck && yarn lint && yarn test`, `yarn test:integration:ephemeral`
- **Exit gate:** ownership test green; smoke green in the ephemeral run; sidebar walk ใบวางบิล → ค่าใช้จ่ายจ่ายสด on the dev server renders the account pickers

### Phase 2 — ค่าใช้จ่ายจ่ายสด redesigned

- **Depends on:** Phase 1 exit gate
- **Outcome:** the owner records an expense without help; the accountant gets the same journal as before
- **Deliverables:** `ExpensesPage.tsx` rebuilt on the brief; th/en keys; TEST-004
- **Requirements closed:** REQ-003, REQ-004
- **Tests:** TEST-004 (+ TEST-002/003 still green)
- **Validation:** unit render test of the strip math; `yarn ds:check`; ephemeral run; dev-server screenshot at 1366 and 375
- **Exit gate:** screenshots reviewed; smoke green; the POST payload for both journeys identical to today's shape

## Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | all screens | hooks | 1 | TEST-001 | AC-001 |
| REQ-002 | all screens | — | 1 | TEST-002, TEST-003 | AC-002 |
| REQ-003 | J-001, J-002 | `POST /expenses` | 2 | TEST-004 | AC-003 |
| REQ-004 | J-001, J-002 | `POST /expenses` unchanged | 2 | TEST-004 | AC-004 |

## Rollout, Migration, and Rollback

No migration. Hooks and the redesigned screen ship in ordinary commits; rollback is `git revert`. The dev server picks the change up by HMR; nothing to run on the tenant.

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| Client-side type filtering changes which accounts a picker shows | wrong account offered | same predicate as the server filter (`account_type`, `is_active`); unit-render checks on the pickers' option lists | none known |
| Chart of accounts > 100 rows | pickers truncated (pre-existing cap) | note in the hook; `failed` never masks it | accepted |
| Smoke spec runtime (≈110 navigations) | slower ephemeral run | single browser context, networkidle waits capped | accepted |
| Regex scanner misses an unusual `useQuery` form | a collision slips by | the "finds > 50 definitions" guard and the "no dynamic key" test fail loudly on scanner drift | low |
| Redesign changes field semantics | wrong posting | payload built from the same fields; TEST-004 checks the journal | low |

## Acceptance Criteria

- [x] **AC-001** — `yarn test` fails when any two Orva files define `useQuery` on the same first key segment; passes on the current tree.
- [x] **AC-002** — In the ephemeral harness every static Orva page loads and the sidebar walk in both directions completes with zero client-side errors.
- [x] **AC-003** — A first-time user sees the screen's purpose in the first line, records a plain receipt with four inputs, and sees เงินออก before saving; the tax block is hidden until the receipt is declared a tax invoice.
- [x] **AC-004** — Both journeys produce journals identical in lines and metadata to the pre-redesign screen.
- [ ] Every listed backend surface matches its recorded reference and uses the canonical shell/components, shared API helpers, semantic tokens, and complete states.
- [ ] Every affected API and UI path has self-contained integration coverage and the configured validation gate passes.

## Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | `.ai/guides/backend-ui.md`, `om-backend-ui-design` refs, `.ai/lessons.md` |
| Data models, APIs, events, UI, and tests are internally consistent | pass | payload unchanged; TEST-004 checks the journal rows |
| Every workflow completes end to end without a catch-all integration phase | pass | two phases, each with its own oracle |
| Platform-native reuse and extension points were chosen before custom code | pass | `fetchCrudList`, shared primitives, harness |
| UI contracts identify references, canonical components, and theme/state coverage | pass | layout above; FormField/Select/RadioField/SwitchField/SegmentedControl/Alert/Skeleton/Table |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | above |

Verdict: `Ready for implementation` (implemented; A1 remains the owner's call — the clarity report for other screens did not complete).

## Resolved assumptions (autonomous defaults)

| ID | Assumption | Rationale | Flag |
|---|---|---|---|
| A1 | "ออกแบบ UI ใหม่" means the expenses screen the owner was on; other screens get a clarity report, not a redesign | The sentence follows the crash report from that screen; redesigning 56 screens unasked is not reversible in a day | ⚠ NEEDS HUMAN CONFIRMATION |
| A2 | Rule = one first segment per file (shared hooks), not "identical queryFn text" | mechanical, explains itself in the failure message | — |
| A3 | Hooks return arrays, not envelopes | every consumer wanted the array | — |
| A4 | Purchasing's `useVendors` moves to `orva_party` and is re-exported from `orva_purchasing/components/pickers.tsx` | owner of the data; no import churn in purchasing | — |
| A5 | The smoke spec lives in `src/modules/orva/__integration__` and its meta lists every Orva module | only cross-module home | — |
| A6 | The API for expenses stays exactly as is | the accountant's journals must not change under a UI change | — |

## Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-001 | Should other screens be redesigned too, and which first? (see the clarity report) | owner | no | pending |

## Changelog

| Date | Change |
|---|---|
| 2026-09-10 | **Phase 1 shipped.** Shared hooks: `orva_finance/components/queries.ts` (`useActiveAccounts` + `byType` + `leafAccounts`, `useOpenPeriods`, `useAllPeriods`, `useGlSettings`, `useApSettings`), `orva_party/components/queries.ts` (`useVendors`, re-exported by purchasing's pickers), `orva_documents/components/queries.ts` (`useProjectOptions`), `orva_tasking/components/queries.ts` (`useLabels` + `labelsQuery`, `useTaskProjects`, `usePortalProjects`), `useVariantSearch` exported from `orva_stock/components/VariantPicker.tsx`. 23 consumer files switched; four keys retired (`accounts.asset/.expense/.options/.active`, `periods.options`). `queryKeyOwnership.test.ts` green (was failing on 12 groups + 1 variable-held key, now resolved). Typecheck, lint (0 errors), ds:check (750 files), 470 unit tests green |
| 2026-09-10 | **Phase 2 shipped.** `ExpensesPage.tsx` rebuilt on the layout above; `lib/expensePosting.ts` (pure, 8 unit tests) maps the three questions onto the unchanged payload (`amount` = gross for none/inclusive, net for exclusive). 106 `orva_finance.expense.*` strings in th/en. Precondition alerts before save: no open period for the receipt's month, AP input-VAT / WHT-payable account unset, empty chart. Header accounts (e.g. 1000) are excluded from pickers by `leafAccounts` — the old form offered a subtotal as a place to pay from |
| 2026-09-10 | **Verified on the dev server, real tenant (nothing posted):** sidebar ใบวางบิลผู้ขาย → ค่าใช้จ่ายจ่ายสด renders with both pickers populated (the crash path); typing 107 + full tax invoice + WHT switch shows 100.00 / 7.00 / −3.00 / 104.00 before any save; submit stays disabled until the invoice number and seller tax id are typed; ล้างฟอร์ม asks through the shared confirm dialog; 375 px has no horizontal scroll; no console errors. Found and fixed on the way: the period warning flashed while the periods list was still loading — a loaded list is now the only thing that can call a month closed |
| 2026-09-10 | The design panel and the crash audit ran as workflows and hit the session limit twice; two of three design proposals and 14 of 65 audit agents completed. The audit's completed finders confirmed the collision and found four `scopeVersion`-less keys (stale options after an organization switch — now impossible, the hooks own the key) and one pre-existing FixedAssets picker quirk (selects without an empty option on a chart lacking 1500/1590/5400 — reported, not fixed here). The remaining redesign synthesis was done by hand from the two proposals |
| 2026-09-10 | **Ephemeral run green: 47 passed** (45 existing + `screens-smoke` + `expenses-screen`). The smoke opened every static Orva page by URL and walked 37 sidebar links forward and backward with 0 problems (~800 ms a screen). TEST-004 posted both journeys and the API confirmed the rows (85 / 0 / 0 / 85 and 100 / 7 / 3 / 104). Four runs to get there, each a harness lesson rather than a screen defect: `__dirname` is undefined in the ESM spec; `networkidle` never arrives while the shell's event stream is open; the CrudForm leave-guard dialog on create pages blocks the next sidebar click (the walk now answers it); the dev server holds `.mercato/next` so it must be stopped first; a killed run leaves `.ai/qa/ephemeral-runtime.lock` behind. Recorded in `ephemeral-integration-env-gotchas.md` |
| 2026-09-09 | Initial draft. Root cause confirmed by reading: 6 envelope sites vs 1 array site on `orva_finance.accounts.all`; the 2026-09-05 fix unwrapped the array and completed the collision. Inventory: 105 definitions, 12 shared segments. `queryKeyOwnership.test.ts` written and failing on exactly those 12; `screens-smoke.spec.ts` written |
