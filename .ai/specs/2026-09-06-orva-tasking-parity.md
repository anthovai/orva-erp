# งาน — full task-management parity as a native Orva module

**Date**: 2026-09-06
**Status**: Ready for implementation — Phases 1–5. The migration and retirement of KKG-Tasking has been split into its own spec and remains blocked on Q-004.

## TLDR

Kaiser Klowns plans delivery in KKG-Tasking (a Vikunja 2.5.0 fork) and bills in
Orva. `orva_tasking` already stores projects and tasks natively and links a
project to the quotation it bills against, but it has no labels, no comments, no
attachments, no board, no timeline, and nothing a customer can look at — so
nobody has moved. This spec closes that gap in six phases so KKG-Tasking can be
switched off: work and money in one database, one login, one backup.

Customers stop receiving an anonymous link and instead sign in to the Orva
Portal, where the same page shows **งานคืบหน้าเท่าไร** beside **ใบเสนอราคาและงวดที่ครบกำหนด** —
something the current system cannot do.

**Clean-room.** Vikunja is AGPL-3.0-or-later and Orva is not. No Vikunja source
is copied. Behaviour is re-implemented from how the team uses the product and
from its public API, the approach already taken in
`2026-08-30-orva-mfa-sso-clean-room.md`. The result will not be pixel-identical,
and that is accepted (Q-000, confirmed 2026-09-06).

## Problem Statement

- **The two numbers never meet.** "งาน 80% เสร็จ แต่เรียกเก็บไป 30%" cannot be seen by
  anyone, because work lives in one database behind one login and billing lives
  in another. `lib/progress.ts` already computes the drift; nothing feeds it
  real task data because the team's real tasks are elsewhere.
- **Customers are shown a different product.** Progress links come from a
  separate system with separate branding and a separate account model. A
  customer cannot see the quotation or the instalment schedule on that page.
- **Two runtimes cost real time.** Two backups, two upgrade paths, two places to
  look when something breaks, and an upstream merge burden carried by hand
  (`fork-update.sh`, `kkg/patches/`).
- **Evidence the current module is not enough.** `orva_tasking` shipped with
  projects, tasks, done, due date, priority and assignee. The team plans with
  boards, labels, sub-tasks, comments and attached files. None of those exist.

## Overview and Success Measures

- **Primary outcome:** KKG-Tasking is switched off, and every project the team
  delivers is planned in Orva. Target: zero tasks created in KKG-Tasking for 14
  consecutive days after Phase 6.
- **Leading indicators:** tasks created per week in `orva_tasking` after each
  phase; number of projects with `customer_visible = true`; portal logins by
  customer users.
- **Baseline:** `orva_tasking` currently holds one test project and two tasks;
  effectively zero. Tasks created per week is read straight from
  `orva_tasking_tasks.created_at` — no instrumentation is needed or built.
- **Market / product reference:** Vikunja 2.5.0 (the system in use) for
  behaviour; Linear and Basecamp for the customer-facing half. Adopted from
  Vikunja: buckets, relation kinds, reminder model, the fork's OverviewShare
  idea of one place covering several projects. Rejected: user-defined views, a
  filter query language, teams, CalDAV, importers — all carry configuration cost
  this team has never used. Adopted from Basecamp: the separation between an
  internal note and something the client can read.

## Goals

- **REQ-001** — A task carries enough detail to plan with: start and end dates,
  manual percent-done, labels, sub-tasks and blockers, comments, and attached
  files.
- **REQ-002** — The team plans on a **board** with named columns, drag between
  columns, and a work-in-progress limit that warns when exceeded.
- **REQ-003** — The team sees a **timeline** of a project's dated work.
- **REQ-004** — The team finds work through a **table view** with column sort
  and a fixed set of filters (assignee, label, due window, done state).
- **REQ-005** — A customer signs in to the Portal and sees, in one place, the
  progress of every project the business chose to show them, drills into any one
  of them, and sees the related quotation and instalment status beside it.
  Internal notes, internal tasks and internal files are never visible.
- **REQ-006** — Work reminds people: due-date reminders, assignment
  notifications, and repeating tasks.
- **REQ-007** — The Projects screen shows **งาน %** beside **เรียกเก็บ %**, and flags
  a project where the two have drifted apart.
- **REQ-008** — Existing KKG-Tasking data is carried across, and the old service
  is retired.

## Non-goals

- **Time tracking** (Q-005 unanswered) — excluded from this spec. If the team
  uses it, it belongs in its own spec, and `orva_hr` already owns staff, so the
  ownership question is real and should not be settled inside a tasking spec.
- Project hierarchy (a project inside a project). Orva already has customer and
  quotation as the natural parents.
- Teams as a separate entity. Assignment is per Orva user; Orva roles carry
  permission (Q-006).
- User-defined project views, a saved-filter language, and saved filters.
- CalDAV · Todoist/Trello/Microsoft-To-Do importers · export archive · emoji
  reactions · project background images · cover images · favourites · task
  colours · mentions · unread state · subscriptions · quick-add magic ·
  PWA/offline · Vikunja API tokens and bot users · LDAP/OIDC team sync ·
  30-language i18n (Orva ships th and en) (Q-007).
- The fork's OpenAI chat (`kkg_ai.go`). Orva's `ai_assistant` can read tasks
  natively once they are in the database; a second assistant is not built
  (Q-008).
- Anonymous token links. Superseded by the Portal decision (Q-002 = Portal).

## Proposed Solution

Extend `orva_tasking` — the module that already owns projects, tasks and the
quotation link — rather than starting again. Six dependency-ordered phases, each
leaving a working app, with KKG-Tasking running beside Orva the whole way until
Phase 6 deliberately retires it.

Two decisions carry the design:

**Customer visibility is a property of a project, not a token.** A logged-in
customer user carries `customer_users.customer_entity_id`; a quotation carries
`sales_quotes.customer_entity_id`; a project carries `quote_id`. That chain
already scopes a customer to exactly their own work with no new sharing entity,
no token to leak, and no link to revoke. A project additionally carries
`customer_visible`, so exposure is an explicit act rather than a consequence of
being linked to a quote.

**Commentary is private by default; the work itself is not.** Publishing a
project is what exposes it, and the tasks in it are the thing the customer came
to see, so a task inside a published project is visible unless individually
hidden. **Comments and attachments are the opposite: `is_customer_visible`
defaults to false**, so an internal note written in the same place the work
happens stays internal. In Vikunja, sharing a project shares all of it. This
asymmetry is deliberate and is the difference between a system the team can
speak freely in and one they cannot. J-003 makes the consequence visible: the
publish dialog lists exactly which tasks are about to become readable, and any
task can be hidden before or after.

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| Clean-room re-implementation | Vikunja is AGPL-3.0-or-later; copying its source would relicense Orva | Port the Go/Vue source | Legally unacceptable; also imports a second runtime, the thing being removed |
| Extend `orva_tasking` | It already owns projects, tasks and the quote link, and they must stay transactionally consistent | New `orva_tasking_board` / `orva_tasking_portal` modules | Splitting one invariant across modules forces cross-module writes for a single user action |
| Customer visibility via Portal login | The customer's quotation, instalments and work can appear on one page; no token to leak; the account model already exists | Anonymous token link (Vikunja's model, and today's behaviour) | A token cannot be tied to a customer, so it can never show that customer's money. Migration cost: customers must be invited once — accepted (Q-002) |
| Scope by `customer_entity_id`, no share entity | The join already exists on both sides and cannot drift | A `project_share` table listing customer users | Duplicates a relationship `sales_quotes` already owns |
| `customer_visible` on the project, off by default | Fail closed. Linking a project to a quote must not publish it | Every quote-linked project visible | One careless link would show a customer internal work |
| `is_customer_visible` on comments and attachments, default false | The team must be able to write internal notes in the same place they do the work | Separate internal-notes field on the task | A single free-text field is not a conversation and cannot be attributed or dated |
| Buckets belong to the **project**, view kinds are fixed | One board per project matches how the team works; Vikunja's per-view buckets exist to support user-defined views, which are a non-goal | Vikunja's `project_view` + per-view buckets | Configuration surface nobody asked for; `project_view.go` is the largest model in the fork at 867 lines |
| Three relation kinds (`subtask`, `blocks`, `related`) | Covers planning; the remaining nine are bookkeeping | All twelve Vikunja kinds | Each kind needs UI, an inverse, and a cycle rule for no observed benefit |
| Reuse `attachments`, `notifications`, `webhooks`, `audit_logs` | Installed, tenant-scoped, already backed up and quota-managed | Own file/notification tables | Rebuilding storage, quota and delivery is the largest avoidable cost in this spec |
| Fixed filters, no query language | The team filters by assignee, label, due window and done state | Vikunja's filter language + saved filters | A parser and its UI for four predicates |

## Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| **โปรเจกต์ (project)** | A named body of work. Optionally bills against exactly one quotation | `orva_tasking_projects` | Second project on the same quote → 409 (unique index, already shipped) |
| **งาน (task)** | One unit of work in exactly one project | `orva_tasking_tasks` | Task in a project of another tenant/org → 404, never 403 with detail |
| `done` / `done_at` | `done_at` is stamped when ticked and cleared when reopened; never derived | check constraint (shipped) | Row rejected by the database |
| `start_date` / `end_date` | Optional. If both present, `start_date <= end_date`. Timeline shows only tasks with both | check constraint | 400 with field error |
| `percent_done` | 0–100, entered by hand, independent of sub-task counts | validator + check constraint | 400 |
| **งาน % (project work percent)** | `done tasks / total tasks`, one decimal. A project with no tasks reports `no_tasks`, never 0% | `lib/progress.ts` (shipped) | Renders "ยังไม่ได้ลงงาน", not "0%" |
| **เรียกเก็บ % (billing percent)** | Confirmed instalment value / quotation total | `orva_finance` | Absent quote → work percent shown alone |
| **drift** | `abs(งาน% − เรียกเก็บ%) >= 20` → flagged, direction named | `workVsBilling` (shipped) | Under threshold → silent; งวด are lumpy |
| **bucket (คอลัมน์)** | A named column on a project's board. Exactly one bucket per project may be the *done bucket*; dropping a task there ticks it done | `orva_tasking_buckets` | Second done bucket → 409 |
| **WIP limit** | Per bucket, 0 = unlimited. Exceeding it **warns and still allows the drop** | `orva_tasking_buckets.wip_limit` | Never blocks — a hard block teaches people to work outside the tool |
| **relation** | `subtask` (inverse `parent`), `blocks` (inverse `blocked_by`), `related` (symmetric). A task may not relate to itself; `subtask` may not form a cycle | `orva_tasking_task_relations` | Cycle → 409 with the offending path |
| **customer-visible project** | `customer_visible = true` **and** `quote_id` is not null **and** that quote's `customer_entity_id` matches the viewer's | project row + `sales_quotes` | Any condition false → the project does not exist for that viewer |
| **internal comment** | `is_customer_visible = false` (the default) | `orva_tasking_task_comments` | Never serialized on any portal route |
| **reminder** | Absolute timestamp, or relative to `due_date` / `start_date` / `end_date` | `orva_tasking_task_reminders` | Reminder whose anchor date is cleared is deleted with it |
| **repeating task** | On completion, a new task is created with dates shifted by the interval; the completed one stays completed | worker | Repeat with no date anchor → 400 at creation |

## Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| Owner / admin (Orva user) | everything, including publishing a project to a customer | organization | `orva_tasking.view`, `orva_tasking.manage`, `orva_tasking.publish` |
| Team member (Orva user) | view, create and edit tasks, comment, attach, move on the board | organization | `orva_tasking.view`, `orva_tasking.manage` |
| Read-only staff | view only | organization | `orva_tasking.view` |
| **Customer user** (portal) | view customer-visible projects and their customer-visible tasks, comments and files; add a comment | **own `customer_entity_id` only** | `orva_tasking.portal.view`, `orva_tasking.portal.comment` |

`tenantId` and `organizationId` come from `getAuthFromRequest` +
`resolveActiveOrganizationId` for backend routes, exactly as the shipped routes
do. Portal routes derive scope from the customer session: `tenantId`,
`organizationId` **and** `customerEntityId` all come from the session record,
never from the request body or query. A portal request whose session has a null
`customer_entity_id` is refused — it cannot be scoped, so it is not served. No
route in this spec uses system scope.

## Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Module | Integration seam | Why |
|---|---|---|---|---|
| Projects, tasks, buckets, labels, relations, comments, reminders | app-own | `orva_tasking` | — | One invariant, one transaction |
| File storage, quota, virus/type policy | reuse | `attachments` | `attachmentScopedUploadService`, `attachmentTargetAccessService` (DI) | Storage, quota and access are solved; rebuilding them is the largest avoidable cost here |
| Notification delivery and grouping | reuse | `notifications` | `buildFeatureNotificationFromType`, `createForFeature` with `groupKey` | Already used by the daily brief and reminder scan |
| Scheduled work (due reminders, repeats) | reuse | `scheduler` | `scheduled_jobs` + a queue worker, as `overdue-reminder-scan` does | Same pattern already running in this app |
| Customer identity, login, invitation, password reset | reuse | `customer_accounts` | `customer_users.customer_entity_id` (scalar ID) | Never rebuild an account model |
| Portal shell, login, dashboard | reuse | `portal` | new frontend pages under `/[orgSlug]/portal/work`, plus a widget on the FROZEN `portal:dashboard:after` host | The shell, session and routing exist |
| Quotation, instalments, billing percent | reuse | `sales`, `orva_finance` | scalar `quote_id` + tenant-filtered SQL | Cross-module ORM relations are forbidden by `AGENTS.md` |
| Outbound webhooks | reuse | `webhooks` | domain events | — |
| Who changed what | reuse | `audit_logs` | domain events | — |
| Free-text search over tasks | reuse | `search` / `query_index` | index contribution (Phase 5) | — |

No CRM, auth, directory, notification or workflow capability is duplicated in
app-owned entities.

## Architecture and Data Flow

```text
Orva user -> /backend/tasking (list | board | timeline | table)
          -> /api/orva_tasking/{projects,tasks,buckets,labels,comments,relations,reminders}
          -> orva_tasking_* (withTenantRls)
          -> orva_tasking.task.* events -> notifications | webhooks | audit_logs
                                        -> query_index (Phase 5)

file upload -> attachmentScopedUploadService -> attachments (target = task id)

scheduler -> orva_tasking:due-reminder-scan  -> notifications
          -> orva_tasking:repeat-task-roll   -> new task rows

Customer  -> /[orgSlug]/portal/work[/{projectId}]
          -> /api/orva_tasking/portal/*  (session-derived customer_entity_id)
          -> projects where customer_visible
             and quote_id in (quotes of that customer_entity_id)
          -> + quotation and instalment status from orva_finance (read-only)
```

- **Module boundaries:** everything a single user action must write atomically
  (task + bucket position + relation) lives in `orva_tasking`. Everything read
  from another module crosses by scalar ID and tenant-filtered SQL.
- **Extension points:** `portal:dashboard:after` (FROZEN, `portal.page.v1`) for
  the customer's progress card. Backend navigation via the module's own page
  metadata. No installed code is modified.
- **Alternatives considered:** keeping tasks in KKG-Tasking and reading them
  over HTTP. Rejected in the prior iteration — the projects list needed one HTTP
  call per project where a native join needs none, and no token model could tie
  a Vikunja viewer to an Orva customer.
- **Compatibility:** the shipped `GET/POST/PUT /api/orva_tasking/projects` and
  `/tasks` response shapes are additive-only across all six phases. The two
  shipped constraints (one project per quotation; `done`/`done_at` agreement)
  are preserved.

## User Journeys

### Journey J-001 — Planning a week on the board

1. A team member opens `/backend/tasking`, picks a project, switches to **บอร์ด**.
2. Columns show the project's buckets; each card shows title, assignee, due
   date, labels, and a sub-task count.
3. They drag a card from **กำลังทำ** to **รอตรวจ**. Position and bucket persist
   optimistically; a failure rolls the card back and flashes the reason.
4. Dropping into the done bucket ticks the task done and stamps `done_at`.
5. If the destination is over its WIP limit, the column header warns; the drop
   still succeeds.

### Journey J-002 — A customer checks progress

1. The customer signs in at `/{orgSlug}/portal/login` (invited once, by email).
2. The dashboard shows a **ความคืบหน้างาน** card: one row per visible project with
   done/total, percent, overdue count and next due date — the same figures the
   fork's overview page shows today.
3. They open a project and see its customer-visible tasks with status and dates,
   the customer-visible comments and files, and beside it the quotation number,
   total, and which instalments are paid or due.
4. They add a comment; the team receives a notification.
5. A project the business has not published does not appear and cannot be
   reached by guessing its URL — the route answers 404.

### Journey J-003 — Publishing a project to a customer

1. The owner opens a project's settings on `/backend/tasking`.
2. `orva_tasking.publish` gates a **ให้ลูกค้าดูได้** switch, disabled with an
   explanation when the project has no `quote_id` — there is no customer to
   scope to.
3. Turning it on lists which tasks will become visible and warns that comments
   and files stay internal until each is marked visible.
4. `orva_tasking.project.published` is emitted; `audit_logs` records who.

### Journey J-004 — A task falls due

1. `orva_tasking:due-reminder-scan` runs each morning.
2. For each task due within the reminder window, unfinished, with an assignee, a
   notification is created with a `groupKey` of task id + date, so re-running the
   scan never sends twice.
3. The assignee sees it in the bell menu and in the morning brief.

## UI and Interaction Contracts

Every surface below reuses the canonical backend shell. Tabular data uses
`DataTable`; create/edit uses `CrudForm`; reads use `apiCall` /
`readApiResultOrThrow`. Implementation must invoke `om-backend-ui-design` and
follow `.ai/guides/backend-ui.md`. Two exceptions are requested and justified
below: the **board** and the **timeline**, neither of which any installed
primitive provides. Both keep the platform shell, tokens, dialogs, empty/error
states and keyboard contract.

Cross-record references follow the reference display rule: the quotation picker
on a project reuses the option source already backing the shipped project form
(`GET /api/orva_documents/projects`, which returns `quoteNumber` and
`customerName`); assignee uses the directory user picker. Raw IDs appear only in
payloads.

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/tasking` (list) | Project chips, progress bar, task table, add task, tick done | `GET/POST/PUT /api/orva_tasking/{projects,tasks}` | shipped `components/TasksPage.tsx` | `Page`, `PageHeader`, `PageBody`, `DataTable` | loading, empty, error, conflict, permission denied | REQ-001 |
| `/backend/tasking?view=board` | Board: columns, drag between them, add column, rename, set WIP, mark done bucket | `GET /api/orva_tasking/buckets`, `PUT /api/orva_tasking/tasks/position` | none installed — **exception, justified** | `Page` shell + custom board body; `Dialog`, `Button`, semantic tokens | loading, empty (no buckets → offer defaults), error, conflict (moved by someone else), over-WIP warning, keyboard move | REQ-002 |
| `/backend/tasking?view=timeline` | Dated work on a horizontal scale, drag to reschedule | `GET /api/orva_tasking/tasks?hasDates=1`, `PUT /api/orva_tasking/tasks` | none installed — **exception, justified** | `Page` shell + custom timeline body | loading, empty (no dated tasks → explain), error, conflict | REQ-003 |
| `/backend/tasking?view=table` | Sortable, filterable task table; bulk tick and bulk assign | `GET /api/orva_tasking/tasks` | `DataTable` usage in `orva_documents` backend list pages | `DataTable`, `CrudForm` | loading, empty, error, conflict, no-results-for-filter | REQ-004 |
| `/backend/tasking/tasks/[id]` (drawer) | Task detail: dates, percent, labels, assignee, relations, comments, files | `/api/orva_tasking/{tasks,comments,relations,labels}`, attachments service | `CrudForm` usage in `orva_documents` | `CrudForm`, `Dialog`, `DataTable` for relations | loading, empty comments, upload progress, upload rejected (quota/type), error, conflict | REQ-001 |
| `/backend/tasking/projects/[id]/settings` | Rename, relink quotation, buckets, archive, **ให้ลูกค้าดูได้** | `PUT /api/orva_tasking/projects`, `/buckets` | `CrudForm` | loading, error, conflict, publish disabled-with-reason, destructive confirm on delete-bucket | REQ-005 |
| `/backend/documents/projects` (existing) | Add **งาน %** beside **เรียกเก็บ %**, and a drift flag | `lib/projects.ts` + `orva_tasking` counts in the same query | the page itself | unchanged | loading, empty, `no_tasks` (not "0%") | REQ-007 |
| `/[orgSlug]/portal/work` | Customer: one row per visible project — done/total, %, overdue, next due; opens a project | `GET /api/orva_tasking/portal/projects` | `portal` frontend pages; app's `frontend/[orgSlug]/portal/lead` | portal shell | loading, empty ("ยังไม่มีงานที่เปิดให้ดู"), error, session expired | REQ-005 |
| `/[orgSlug]/portal/work/[projectId]` | Customer: visible tasks, visible comments and files, quotation and instalment status; add a comment | `GET /api/orva_tasking/portal/projects/[id]`, `POST /api/orva_tasking/portal/comments` | as above | portal shell | loading, 404 for a project not theirs, error, comment submitting/failed | REQ-005 |
| `portal:dashboard:after` widget | Progress summary card with a link into `/portal/work` | `GET /api/orva_tasking/portal/projects` | `portal.page.v1` render-widget contract | host-provided | loading, empty (render nothing), error (render nothing, log) | REQ-005 |

### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| Owner / team | โปรเจกต์ → **งาน** (existing entry, gains the view switcher) | morning brief already lists overdue work | login → งาน → board = 2 clicks |
| Customer | portal: หน้าแรก → **งานของเรา** | progress card on `portal:dashboard:after` | login → dashboard card → project = 2 clicks |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| Board | "ยังไม่มีคอลัมน์ — สร้างชุดเริ่มต้น (รอทำ · กำลังทำ · เสร็จ)" with a button | columns scroll horizontally in their own container; body never scrolls sideways | card focusable; `Space` picks up, arrows move, `Space` drops, `Esc` cancels — full parity with the mouse |
| Timeline | "ยังไม่มีงานที่มีวันเริ่มและวันจบ" + link to the table view | falls back to the table view below 768px | arrow keys shift a selected bar by one day |
| Portal project list | "ยังไม่มีงานที่เปิดให้ดู ติดต่อผู้ดูแลโครงการ" | single column below 768px | standard link order |
| Task drawer | "ยังไม่มีคอมเมนต์" | full-screen sheet below 768px | focus trapped; `Esc` closes; focus returns to the row |

### `/backend/tasking?view=board` — Board

```text
┌──────────────────────────────────────────────────────────────┐
│ งาน   [รายการ][บอร์ด][ไทม์ไลน์][ตาราง]        [+ โปรเจกต์ใหม่] │
│ (ชิปโปรเจกต์)  เว็บ CC Tech 1/2 · KK-QTN-2026011              │
├──────────────────────────────────────────────────────────────┤
│ ┌ รอทำ 3 ──┐ ┌ กำลังทำ 2/2 ⚠┐ ┌ รอตรวจ 1 ─┐ ┌ เสร็จ ✓ 4 ─┐  │
│ │ [การ์ด]  │ │ [การ์ด]      │ │ [การ์ด]   │ │ [การ์ด]    │  │
│ │ [การ์ด]  │ │ [การ์ด]      │ │           │ │            │  │
│ │ + เพิ่ม  │ │ + เพิ่ม      │ │ + เพิ่ม   │ │            │  │
│ └──────────┘ └──────────────┘ └───────────┘ └────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

- **Behavior:** drag or keyboard to move; optimistic update with rollback and a
  flash on failure; `updatedAt` sent with every move and a 409 re-fetches the
  board and tells the user someone else moved the card; the done bucket ticks
  `done` and stamps `done_at` through the same route that a checkbox uses, never
  a second code path; deleting a bucket asks first and moves its cards to the
  first bucket.
- **Responsive and accessibility:** each card is a focusable element with an
  accessible name of "title, column, due"; moves announce through a live region;
  the column container scrolls, not the page.
- **Localization:** `orva_tasking.*` in **both** `th.json` and `en.json` — every
  key present in both, per `AGENTS.md`.
- **Design-system and theming:** semantic tokens only (`bg-card`, `text-muted-
  foreground`, `bg-status-error-bg`); verified in light and dark; no hard-coded
  palette or status colours; drag affordance respects reduced motion.

### `/[orgSlug]/portal/work` — Customer work list

```text
┌──────────────────────────────────────────────────────────────┐
│ งานของเรา                                                    │
├──────────────────────────────────────────────────────────────┤
│ เว็บไซต์ CC Tech        8/10 · 80%   เลยกำหนด 1  ครบ 12 ก.ย. →│
│ ป้ายหน้าร้าน            3/3 · 100%                        →│
├──────────────────────────────────────────────────────────────┤
│ (ว่าง) ยังไม่มีงานที่เปิดให้ดู                                │
└──────────────────────────────────────────────────────────────┘
```

- **Behavior:** read-only apart from adding a comment; every figure is computed
  server-side inside the customer's scope; no project id appears in the UI text.
- **Responsive and accessibility:** single column below 768px; each row is a
  link with an accessible name including the percentage.
- **Localization:** Thai first; both files carry every key.
- **Design-system and theming:** portal shell tokens; light and dark verified.

## Data Models

Existing `orva_tasking_projects` and `orva_tasking_tasks` are extended;
everything else is new. Every table carries `tenant_id` and `organization_id`,
composite scope indexes, `created_at`, `updated_at` (optimistic-lock version) and
`deleted_at`, and **every migration ends with `this.addSql('select
orva_apply_rls();')`** per `CLAUDE.md`.

### `orva_tasking_projects` — added columns

| Field | Type / nullability | Scope / index | Sensitive | Lifecycle and validation |
|---|---|---|---|---|
| `customer_visible` | boolean, not null, default **false** | partial index with `quote_id` | no | may only be true when `quote_id` is not null (check constraint) |
| `customer_label` | text, nullable, ≤120 | — | no | what the customer sees instead of the internal name |
| `published_at` / `published_by` | timestamp / UUID, nullable | — | no | stamped when `customer_visible` turns true, cleared when it turns false |

### `orva_tasking_tasks` — added columns

| Field | Type / nullability | Scope / index | Sensitive | Lifecycle and validation |
|---|---|---|---|---|
| `start_date` / `end_date` | date, nullable | index on `(tenant_id, organization_id, start_date)` | no | `start_date <= end_date` (check constraint) |
| `percent_done` | smallint, not null, default 0 | — | no | 0–100 (check constraint) |
| `bucket_id` | UUID, nullable | index | no | must belong to the task's project (validated in the write path) |
| `customer_visible` | boolean, not null, default true | — | no | deliberately the opposite default from comments and attachments — see Proposed Solution. Only ever read inside a **published** project, so an unpublished project exposes nothing regardless. Any task can be hidden individually |
| `repeat_every_days` | int, nullable | — | no | > 0; requires at least one date anchor |
| `repeat_mode` | text, nullable | — | no | `from_due` \| `from_completion` |
| `identifier_index` | int, not null | unique `(project_id, identifier_index)` | no | per-project counter; renders as `เว็บ CC Tech-12` |

### `orva_tasking_buckets` (new)

| Field | Type / nullability | Scope / index | Sensitive | Lifecycle and validation |
|---|---|---|---|---|
| `project_id` | UUID, not null | index `(tenant_id, project_id, position)` | no | — |
| `title` | text, not null, ≤80 | — | no | — |
| `position` | int, not null | — | no | — |
| `wip_limit` | int, not null, default 0 | — | no | 0 = unlimited; exceeding warns, never blocks |
| `is_done_bucket` | boolean, not null, default false | **unique partial index** `(project_id) where is_done_bucket and deleted_at is null` | no | at most one per project |

### `orva_tasking_labels` and `orva_tasking_task_labels` (new)

Label: `title` (≤60), `hex_color` (validated `^#[0-9a-fA-F]{6}$`), unique
`(tenant_id, organization_id, lower(title)) where deleted_at is null`.
Link table: `(task_id, label_id)` unique; hard rows, no soft delete.

### `orva_tasking_task_relations` (new)

`task_id`, `other_task_id`, `kind` in (`subtask`, `blocks`, `related`). Unique
`(task_id, other_task_id, kind)`. Self-reference rejected. Both directions are
stored so a read needs no `union`. `subtask` cycles rejected with the path.

### `orva_tasking_task_comments` (new)

| Field | Type / nullability | Sensitive | Lifecycle and validation |
|---|---|---|---|
| `task_id` | UUID, not null | no | index `(tenant_id, task_id, created_at)` |
| `body` | text, not null, ≤8000 | **free text about people and work** | stored plain — see Security below |
| `author_user_id` | UUID, nullable | no | an Orva user |
| `author_customer_user_id` | UUID, nullable | no | a portal user; exactly one author column is non-null (check constraint) |
| `is_customer_visible` | boolean, not null, **default false** | no | a comment written by a customer is created with `true` |
| `edited_at` | timestamp, nullable | no | edits allowed for 15 minutes by the author only |

### `orva_tasking_task_reminders` (new)

`task_id`, `remind_at` (timestamp, nullable), `relative_to`
(`due` \| `start` \| `end`, nullable), `relative_minutes` (int, nullable),
`last_fired_at`. Exactly one of absolute or relative (check constraint). A
reminder whose anchor date is cleared is deleted in the same transaction.

### Attachments

No new table. Files attach through `attachmentScopedUploadService` with the task
id as target; visibility to a customer is a `orva_tasking_task_attachment_flags`
row (`attachment_id`, `is_customer_visible`, default false) so the installed
`attachments` entity is never modified.

### Migrations

One migration per phase, each ending in `select orva_apply_rls();`. Column adds
are nullable-or-defaulted so they apply to a populated table without a lock-heavy
rewrite. `identifier_index` backfills by `created_at` order per project inside
the same migration, guarded with `to_regclass` — the lesson recorded in
`c051601` after `orva_hr` backfilled from a table that did not yet exist.

## API, Command, and Error Contracts

Backend routes follow the shipped pattern: per-method `metadata` with
`requireFeatures`, `openApi` documentation, zod validators in
`data/validators.ts`, `withTenantRls`, and `updatedAt` optimistic locking with
409. Routes are hand-written guarded routes rather than `makeCrudRoute` for the
same reason the shipped ones are: the reads are aggregate joins, not row lists.

| Method | Path | Auth and feature gate | Input | Success / event | Errors | Requirement |
|---|---|---|---|---|---|---|
| `GET` | `/api/orva_tasking/projects` | `orva_tasking.view` | — | `{ items }` (**additive** — gains `customerVisible`, `bucketCount`) | 401/403 | REQ-001 |
| `PUT` | `/api/orva_tasking/projects` | `orva_tasking.manage` | + `customerLabel` | `{ ok }` | 400/403/409 | REQ-001 |
| `GET` | `/api/orva_tasking/tasks` | `orva_tasking.view` | + `hasDates`, `assigneeUserId`, `labelId`, `dueWithinDays` (all optional) | `{ items }` (**additive** — gains dates, percent, labels, bucket, relation and comment counts) | 400/401/403 | REQ-001, REQ-003, REQ-004 |
| `POST` | `/api/orva_tasking/tasks` | `orva_tasking.manage` | + dates, percent, labels, bucket, repeat | `{ ok, id }` + `orva_tasking.task.assigned` when an assignee is set | 400 (repeat with no date anchor), 403/404 | REQ-001, REQ-006 |
| `PUT` | `/api/orva_tasking/tasks` | `orva_tasking.manage` | + the same fields, with `updatedAt` | `{ ok, done, updatedAt }` + `task.assigned` on assignee change | 400/403/404/409 | REQ-001 |
| `POST` | `/api/orva_tasking/projects/publish` | **`orva_tasking.publish`** | `{ id, visible, updatedAt }` | `orva_tasking.project.published` | 400 (no quote), 403, 409 | REQ-005 |
| `GET`/`POST`/`PUT`/`DELETE` | `/api/orva_tasking/buckets` | view / manage | `{ projectId, title, position, wipLimit, isDoneBucket }` | `{ ok }` | 400/403/409 (second done bucket) | REQ-002 |
| `PUT` | `/api/orva_tasking/tasks/position` | `orva_tasking.manage` | `{ id, bucketId, position, updatedAt }` | `{ ok, done, updatedAt }` + `orva_tasking.task.moved` | 403/404/409 | REQ-002 |
| `GET`/`POST`/`DELETE` | `/api/orva_tasking/labels` | view / manage | `{ title, hexColor }` | `{ ok }` | 400/409 (duplicate title) | REQ-001 |
| `GET`/`POST`/`PUT`/`DELETE` | `/api/orva_tasking/comments` | view / manage | `{ taskId, body, isCustomerVisible }` | `orva_tasking.comment.created` | 400/403/404/409 | REQ-001 |
| `POST`/`DELETE` | `/api/orva_tasking/relations` | manage | `{ taskId, otherTaskId, kind }` | `{ ok }` | 400 (self), 409 (cycle) | REQ-001 |
| `GET`/`POST`/`DELETE` | `/api/orva_tasking/reminders` | view / manage | absolute or relative | `{ ok }` | 400 | REQ-006 |
| `GET` | `/api/orva_tasking/portal/projects` | **customer session** + `orva_tasking.portal.view` | — | `{ items: [{ name, total, done, percent, overdue, nextDue }] }` | 401, 403 (session without `customer_entity_id`) | REQ-005 |
| `GET` | `/api/orva_tasking/portal/projects/[id]` | customer session | — | project + visible tasks + visible comments + visible files + quotation and instalment status | **404** for anything not theirs | REQ-005 |
| `POST` | `/api/orva_tasking/portal/comments` | customer session + `orva_tasking.portal.comment` | `{ taskId, body }` | `orva_tasking.comment.created` (customer author, `is_customer_visible = true`) | 400/401/404 | REQ-005 |

Portal routes never accept a `projectId` filter, tenant, organization or
customer id from the caller; every scope value is read from the session record.
A project or task outside the caller's scope produces **404, not 403** — a 403
would confirm the record exists.

## Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit |
|---|---|---|---|---|
| `orva_tasking.task.assigned` | tasks route | `notifications` | assignee notified | `groupKey` = task id + assignee; at-least-once, deduped by key |
| `orva_tasking.task.moved` | position route | `audit_logs`, `webhooks` | history | post-commit only |
| `orva_tasking.comment.created` | comments route | `notifications` | assignee, or the whole team when the author is a customer | `groupKey` = comment id |
| `orva_tasking.project.published` | publish route | `audit_logs` | who exposed what, when | post-commit |
| `orva_tasking:due-reminder-scan` (daily, weekdays) | `scheduler` | worker → `notifications` | one notification per due task | `groupKey` = task id + date; re-running the scan sends nothing new |
| `orva_tasking:repeat-task-roll` (daily) | `scheduler` | worker | creates the next occurrence of a completed repeating task | keyed on source task id + occurrence date; a re-run creates nothing |

Both workers **raise notifications and never send mail** — the pattern set by
`overdue-reminder-scan` and `daily-brief`. Effects are post-commit. Jobs are
seeded by a migration, not by `setup.ts seedDefaults`, which runs only at tenant
creation and would therefore never reach the existing tenant.

## Security, Privacy, and Compliance

- **Authorization:** feature gates only — `orva_tasking.view`, `.manage`,
  `.publish`, `.portal.view`, `.portal.comment`. No role-name checks anywhere.
  `.publish` is separate from `.manage` because exposing work to a customer is a
  different act from editing it.
- **Tenant isolation:** every read and write inside `withTenantRls`; RLS forced
  on all new tables (`node scripts/verify-rls.mjs` is a phase exit gate).
  Portal routes add the `customer_entity_id` predicate **inside** the SQL, not in
  application code after the fact.
- **Sensitive data:** comment bodies are free text about people and work. They
  are stored **unencrypted and deliberately**: encrypting them would make them
  unsearchable and unsortable, and this repository has twice shipped bugs from
  reading encrypted columns in raw SQL (`.ai/lessons/raw-sql-on-encrypted-columns-
  leaks-ciphertext.md`). Instead they are protected by RLS, the feature gate and
  the `is_customer_visible` default of false. `customer_entities.display_name`
  **is** encrypted, so every customer-scoping join in this spec uses
  `customer_entity_id`, never a name, and any customer name rendered on a portal
  page comes through `findWithDecryption`.
- **Abuse and failure modes:** portal enumeration answered with 404; comment
  bodies length-capped and rendered as text, never HTML; uploads inherit the
  `attachments` module's type and quota policy; every mutation carries
  `updatedAt` and answers 409 rather than overwriting; bucket deletion is
  confirmed and moves cards rather than deleting them; a customer comment cannot
  set `is_customer_visible = false` and cannot target a task outside their scope.

## Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement |
|---|---|---|---|---|---|
| TEST-001 | integration | project + 4 tasks | set dates, percent, labels, sub-task relation | persisted; `start > end` rejected; cycle rejected | REQ-001 |
| TEST-002 | security | two tenants, each with a project | read and move a task across the boundary | 404; no row changed; no name in the body | REQ-001 |
| TEST-003 | integration | project with 3 buckets, WIP 2 | move a task into a full bucket; move into done bucket | move succeeds with a warning flag; done bucket sets `done` **and** `done_at` | REQ-002 |
| TEST-004 | integration | two clients read the same board | both move the same card | second gets 409; board state is the first move | REQ-002 |
| TEST-005 | UI | project with dated and undated tasks | open timeline; drag a bar; shift a selected bar with the arrow keys | dated bars render; undated listed as excluded; empty state when none; **both reschedules persist the same new dates and a stale one returns 409** | REQ-003 |
| TEST-006 | UI | 30 tasks | sort, filter by assignee/label/due/done | correct rows; no-results state; keyboard reachable | REQ-004 |
| TEST-007 | integration | customer A (2 projects, 1 published), customer B (1 published) | A calls the portal routes | only A's published project; B's returns 404 | REQ-005 |
| TEST-008 | security | published project with one internal and one visible comment, one internal file | A reads the project | internal comment and internal file absent from the payload — asserted on the raw JSON, not the DOM | REQ-005 |
| TEST-009 | integration | customer A | post a comment | stored with `author_customer_user_id`, `is_customer_visible = true`; team notified | REQ-005 |
| TEST-010 | security | session whose `customer_entity_id` is null | call every portal route | 403 on all; nothing leaked | REQ-005 |
| TEST-011 | integration | tasks due today, tomorrow, and done | run `due-reminder-scan` twice | one notification per qualifying task; second run adds none | REQ-006 |
| TEST-012 | integration | repeating task completed | run `repeat-task-roll` twice | exactly one successor; dates shifted; original still done | REQ-006 |
| TEST-013 | integration | project with 4 of 5 tasks done, quote 30% billed | read the Projects screen data | งาน 80%, เรียกเก็บ 30%, drift flagged `bill_behind` | REQ-007 |
| TEST-014 | integration | project with no tasks | same | `no_tasks`, **not** 0% | REQ-007 |
| TEST-015 | UI | board, light and dark, 375px and desktop | drag with mouse and with keyboard | same result both ways; live-region announcement; no horizontal body scroll | REQ-002 |
| TEST-016 | integration | export fixture from KKG-Tasking | run the importer twice | projects/tasks/comments created once; second run changes nothing | REQ-008 |
| TEST-017 | integration | project with a quote and 3 tasks, one hidden | publish, then unpublish | `published_at`/`published_by` stamped then cleared; `orva_tasking.project.published` emitted once each way; audit row written; publishing a project with no `quote_id` returns 400 | REQ-005 |
| TEST-018 | integration | project with 3 buckets, cards in the second | delete the second bucket | cards move to the first bucket and are **not** deleted; a done bucket cannot be deleted while it is the only one | REQ-002 |
| TEST-019 | integration | — | create a repeating task with no due, start or end date | 400 with a field error; no row written | REQ-006 |
| TEST-020 | integration | task with an absolute and a relative reminder | clear the task's due date | the relative reminder is deleted in the same transaction; the absolute one survives | REQ-006 |

## Implementation Phases

### Phase 1 — Task detail depth

- **Depends on:** none
- **Outcome:** a task can be planned with: start/end dates, percent, labels,
  sub-tasks and blockers, comments, and attached files.
- **Why this order:** every later phase reads these columns — the timeline
  cannot exist without dates, the board card without labels, the portal without
  comments.
- **Deliverables:** migration (task/project columns, labels, link table,
  relations, comments, attachment flags, `identifier_index` backfill, RLS);
  entities; validators; `/api/orva_tasking/{labels,comments,relations}`;
  attachments wiring via DI; task drawer on `/backend/tasking`; th + en keys.
- **Independent slices:** labels · comments · relations · attachments (four)
- **Requirements closed:** REQ-001
- **Tests:** TEST-001, TEST-002
- **Validation:** `yarn generate && yarn typecheck && yarn lint && yarn ds:check && yarn test`, `node scripts/verify-rls.mjs`
- **Exit gate:** a task carries every new field through create → read → edit →
  conflict; RLS forced on every new table; drawer verified in light and dark and
  at 375px. **Restart the dev server** — new entities are bundled at boot
  (`.ai/lessons/new-entity-needs-dev-restart.md`).

### Phase 2 — Planning views

- **Depends on:** Phase 1
- **Outcome:** the team plans on a board, and reads the same work as a table and
  a timeline.
- **Why this order:** the board is where the team actually works; until it
  exists, nobody moves off KKG-Tasking.
- **Deliverables:** buckets migration + entity + routes; `tasks/position` route;
  view switcher; board (drag and keyboard); table on `DataTable` with the four
  filters; timeline; default bucket seeding for existing projects.
- **Independent slices:** table (cheapest, lands first) · board · timeline
- **Requirements closed:** REQ-002, REQ-003, REQ-004
- **Tests:** TEST-003, TEST-004, TEST-005, TEST-006, TEST-015, TEST-018
- **Validation:** as Phase 1, plus browser verification of drag and keyboard
- **Exit gate:** a card moves by mouse **and** by keyboard with identical
  results; a concurrent move produces 409 and recovers; the done bucket ticks
  `done_at`; light/dark and 375px verified.

### Phase 3 — Customer visibility through the Portal

- **Depends on:** Phase 1 (comments, files, dates). **Not** Phase 2 — nothing on
  a portal page reads a bucket, so this phase can run in parallel with the board
  if there is a second pair of hands.
- **Outcome:** a customer signs in and sees their published projects, drills in,
  and sees the quotation and instalments beside the work.
- **Why this order:** this is the one capability blocking KKG-Tasking's
  retirement, and it needs Phase 1's comments and files to be worth reading.
- **Deliverables:** publish route + `orva_tasking.publish` feature; project
  settings switch; portal pages `/[orgSlug]/portal/work[/id]`; portal API routes;
  `portal:dashboard:after` widget; finance read for quotation/instalment status.
- **Independent slices:** publish + settings · portal API · portal UI + widget
- **Requirements closed:** REQ-005
- **Tests:** TEST-007, TEST-008, TEST-009, TEST-010, TEST-017
- **Validation:** as Phase 1, plus the four security tests
- **Exit gate:** a second customer cannot reach the first's project by any URL;
  internal comments and files are absent from the raw JSON; the empty state
  reads correctly for a customer with nothing published.

### Phase 4 — Reminders, repeats, notifications

- **Depends on:** Phase 1 (dates)
- **Outcome:** work reminds people without anyone watching a list.
- **Deliverables:** reminders table + routes; `due-reminder-scan` and
  `repeat-task-roll` workers; job rows seeded by migration; notification types;
  assignment and comment notifications.
- **Independent slices:** reminders · repeats
- **Requirements closed:** REQ-006
- **Tests:** TEST-011, TEST-012, TEST-019, TEST-020
- **Validation:** as Phase 1; run each worker twice against a seeded tenant
- **Exit gate:** running a worker twice produces no duplicate notification; the
  written down-step that deletes the two `scheduled_jobs` rows has been executed
  once on a copy (see Rollback); restart the dev server so the new workers are
  registered.

### Phase 5 — งาน % beside เรียกเก็บ %, and finding work

- **Depends on:** Phase 1. `workVsBilling` counts done tasks against a
  quotation; it reads no bucket and no view.
- **Outcome:** the Projects screen answers the question this module exists for,
  and tasks are searchable.
- **Deliverables:** `workVsBilling` wired into `orva_documents` Projects screen
  in one query; `query_index` contribution for task titles; global search hit.
- **Independent slices:** projects screen · search index
- **Requirements closed:** REQ-007
- **Tests:** TEST-013, TEST-014
- **Validation:** as Phase 1
- **Exit gate:** a project with no tasks reads "ยังไม่ได้ลงงาน", never 0%; the drift
  flag names its direction.

### Phase 6 — Migrate and retire KKG-Tasking — **placeholder; becomes its own spec**

- **Depends on:** Phases 1–5, **and Q-004**
- **Status:** deliberately unspecified. An adversarial review of this document
  named it the weakest section and was right: it is the primary outcome and the
  only irreversible step, yet it has no field mapping, no mapping from Vikunja
  user identities to Orva users and customer users, and no reconciliation report
  format. Those cannot be written before Q-004 says what "history" includes.
- **Therefore:** when Q-004 is answered, Phase 6 leaves this document and is
  written as its own spec — a data migration with an irreversible cutover is a
  different kind of work from a feature phase and deserves its own review.
  Sketch only: an idempotent importer reading the KKG-Tasking API; a
  reconciliation report; removal of `vendor/kkg-tasking`, the `tasking` compose
  service and the `/tasks` + `/tasks-api` rewrites.
- **Requirements closed:** REQ-008 (in that spec, not this one)
- **Tests:** TEST-016 (sketch)
- **Exit gate:** counts reconcile against the source; a second run changes
  nothing; the app builds and boots with the compose service removed.

## Requirement Traceability

| Requirement | Journey / surface | Contracts | Phase | Tests | Acceptance |
|---|---|---|---|---|---|
| REQ-001 | J-001, task drawer | task/project columns, `tasks`, labels, relations, comments, attachments | 1 | TEST-001, TEST-002 | AC-001 |
| REQ-002 | J-001, `?view=board` | `buckets`, `tasks/position`, `task.moved` | 2 | TEST-003, TEST-004, TEST-015, TEST-018 | AC-002 |
| REQ-003 | `?view=timeline` | `tasks?hasDates=1`, `PUT /tasks` | 2 | TEST-005 | AC-003 |
| REQ-004 | `?view=table` | `tasks` + filters | 2 | TEST-006 | AC-003 |
| REQ-005 | J-002, J-003, portal | publish route, portal routes, dashboard widget | 3 | TEST-007…010, TEST-017 | AC-004, AC-005 |
| REQ-006 | J-004 | reminders, both workers | 4 | TEST-011, TEST-012, TEST-019, TEST-020 | AC-006 |
| REQ-007 | Projects screen | `workVsBilling` in one query | 5 | TEST-013, TEST-014 | AC-007 |
| REQ-008 | — | importer, compose removal | **own spec** (was Phase 6) | TEST-016 | AC-008 |

## Rollout, Migration, and Rollback

- **Migrations:** generated with `yarn db:generate`, SQL reviewed, and applied
  only with the user's approval — never to validate. Each ends with
  `select orva_apply_rls();`; `node scripts/verify-rls.mjs` is a phase gate.
- **Seeding:** scheduled jobs and default buckets are created by migration, not
  by `setup.ts seedDefaults`, which runs only at tenant creation and would never
  reach the existing tenant.
- **Permissions:** each phase's new features (`orva_tasking.publish`,
  `.portal.view`, `.portal.comment`) must be granted to the relevant roles by the
  owner before the surface is reachable. This is an owner action, listed at each
  phase exit, not something this spec grants.
- **Rollout order:** KKG-Tasking keeps running through Phases 1–5. Phase 3 ships
  the Portal to **one** customer first; broader invitation follows a week later.
- **Rollback:** Phases 1, 2, 3 and 5 are additive — new columns are nullable or
  defaulted and new tables are unreferenced by installed code, so reverting the
  app code leaves a working database. Phase 3 also rolls back *without* a deploy:
  setting `customer_visible = false` on every project removes customer access
  immediately.
  **Phase 4 is the exception.** Its migration seeds `scheduled_jobs` rows naming
  workers that a reverted build no longer registers, so the queue would log
  unknown-worker failures every run. Reverting Phase 4 therefore requires
  deleting those two job rows as well; the phase ships that delete as a written
  down-step, and the exit gate is not met until it has been executed once on a
  copy.
  Phase 6 is the only irreversible step and is gated on the importer's
  reconciliation report.
- **Observability:** counts of tasks created per week, notifications sent per
  worker run, and portal logins.

## Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual |
|---|---|---|---|
| A customer sees another customer's work | severe — confidentiality | scoping predicate inside SQL, not application code; TEST-007/008/010; 404 not 403 | a bug in the finance read could still leak a quote number; that read is covered by TEST-008 |
| An internal comment reaches a customer | severe | `is_customer_visible` defaults to false; asserted on raw JSON in TEST-008 | a person can still mark the wrong comment visible — the act is audited |
| Customers will not adopt a login | rollout stalls | one customer first; invitation email; the page shows their money, which the old link never did | some customers may resist; a per-project read-only link could be added later as its own spec |
| Board concurrency corrupts order | moderate | `updatedAt` on every move; 409 and re-fetch; TEST-004 | fractional positions can crowd after very many moves — renumber job if observed |
| Comment bodies unencrypted | moderate | RLS + feature gate + visibility default; the alternative has caused two shipped bugs | a database-level compromise reads them |
| `identifier_index` backfill on a populated table | low now, higher later | `to_regclass` guard and per-project ordering, tested on a copy | — |
| Scope creep back toward full Vikunja | schedule | non-goals are explicit and each phase ships alone | pressure to add saved filters is likely |
| Retiring KKG-Tasking loses history | severe if wrong | Phase 6 gated on a reconciliation report and a twice-run importer; the fork's repository is kept | Q-004 must answer what "history" includes |

## Acceptance Criteria

- [ ] **AC-001** — A team member creates a task with start and end dates, a
      percent, two labels, a sub-task and a blocker, writes a comment and
      attaches a file; all persist and reload; `start > end` is refused.
- [ ] **AC-002** — A card moves between columns by mouse and by keyboard with
      identical results; a concurrent move returns 409 and recovers; the done
      bucket sets `done` and `done_at`.
- [ ] **AC-003** — Timeline and table render the same project's work; each has a
      correct empty and no-results state; a timeline bar reschedules by drag and
      by keyboard to the same dates, and a stale reschedule returns 409.
- [ ] **AC-004** — A customer signs in and sees only their published projects,
      with done/total, percent, overdue count and next due date, and the
      quotation and instalment status on the project page.
- [ ] **AC-005** — Another customer's project returns 404 by any URL, and no
      internal comment, task or file appears in any portal response body.
- [ ] **AC-006** — Running each worker twice produces no duplicate notification.
- [ ] **AC-007** — The Projects screen shows งาน % beside เรียกเก็บ % and flags
      drift by direction; a project with no tasks reads "ยังไม่ได้ลงงาน".
- [ ] **AC-008** — The importer run twice reconciles against the source and
      changes nothing on the second run; the app builds and boots with the
      `tasking` compose service removed.
- [ ] Every listed surface uses the canonical shell, shared API helpers and
      semantic tokens, with loading, empty, error, conflict, keyboard,
      accessibility, responsive, light and dark states — the board and timeline
      exceptions justified above included.
- [ ] Every API and UI path has self-contained integration coverage and the
      validation gate passes.

## Final Compliance Report

| Check | Status | Evidence |
|---|---|---|
| Applicable `AGENTS.md` / `CLAUDE.md` and routed guides reviewed | pass | RLS rule, no cross-module ORM relations, th+en keys, ask-before-migrate all reflected |
| Data models, APIs, events, UI and tests internally consistent | pass | traceability table; every REQ has a phase, tests and an AC. Four inconsistencies found by adversarial review on 2026-09-06 and fixed: task `customer_visible` contradicting the prose, Phase 3 and Phase 5 naming the wrong dependency, the missing `/api/orva_tasking/tasks` contract rows, and an unbuilt instrumentation claim |
| Adversarial scope review performed by a reviewer that did not write the spec | pass | findings applied; the reviewer's Phase 6 verdict accepted in full, its portal-split argument recorded and declined with reasons (Q-001) |
| Every workflow completes end to end without a catch-all phase | pass | J-001…J-004 each close inside a named phase |
| Platform-native reuse chosen before custom code | pass | attachments, notifications, scheduler, portal, customer_accounts, webhooks, audit_logs reused |
| UI contracts identify references, canonical components, theme/state coverage | pass | two custom surfaces (board, timeline) with written rationale; all others canonical |
| Every phase has dependencies, slices, tests, value and an exit gate | pass | Phases 1–6 |
| Licensing | pass | clean-room; no Vikunja source copied (Q-000 confirmed) |
| No blocking open question remains | **fail** | Q-004 blocks the migration work, which has left this spec |

**Verdict: Blocked — Q-004 (migration scope), which now blocks only the separate
migration spec. Phases 1–5 of this spec are ready for implementation.**

## Open Questions

| ID | Question | Owner | Blocking? | Resolution |
|---|---|---|---|---|
| Q-000 | Clean-room, no Vikunja source copied | owner | yes | **Resolved 2026-09-06** — confirmed |
| Q-001 | One spec or several | owner | yes | **Resolved 2026-09-06** — one spec for Phases 1–5, because they share one data model and one actor: splitting the board from the task detail it renders would put a single user action across two documents. **Revised after adversarial review:** the migration and retirement (was Phase 6) is a different actor-free, irreversible kind of work and leaves this spec. The reviewer also argued the customer portal deserves its own spec on threat-model grounds; kept here because its scoping predicate is a join over `orva_tasking` columns defined in Phase 1, and separating them would let the two drift |
| Q-002 | Customer visibility mechanism | owner | yes | **Resolved 2026-09-06** — Portal login; anonymous token links are a non-goal |
| Q-003 | One place covering several projects, with drill-down | owner | yes | **Resolved 2026-09-06** — yes; `/portal/work` reproduces the fork's overview behaviour |
| Q-004 | Migrate from KKG-Tasking: everything (comments, files, finished history, authorship) or open tasks only? | owner | **yes — Phase 6** | pending |
| Q-005 | Time tracking | owner | no | **Resolved** — non-goal; its own spec if needed |
| Q-006 | Teams | owner | no | **Resolved** — no team entity; Orva users and roles |
| Q-007 | Dropped features | owner | no | **Resolved** — see Non-goals |
| Q-008 | The fork's AI chat | owner | no | **Resolved** — dropped; `ai_assistant` reads native tasks |
| Q-009 | Cutover | owner | no | **Resolved** — side by side through Phases 1–5; retire in Phase 6 |

## Implementation Status

### Phase 1 — Task detail depth — `in_progress` (code complete, migration not applied)

| Deliverable | State | Evidence |
|---|---|---|
| Migration `Migration20260906140000_tasking_detail` | written, **not applied** | replayed over fixtures in a rolled-back transaction: applies clean, `orva_apply_rls()` reports 274 tables, RLS forced on all 5 new tables |
| Task columns: `start_date`, `end_date`, `percent_done`, `identifier_index` | done | date-order and 0–100 constraints both proven to reject and to accept |
| `identifier_index` backfill | done | 4 fixture tasks numbered Probe A 1–3, Probe B 1 — per project, oldest first |
| Labels + junction | done | `#rrggbb` constraint rejects `red`; case-insensitive title uniqueness rejects `URGENT` after `Urgent` |
| Relations (3 kinds, both directions, cycle guard) | done | 10 unit tests; DB rejects self-link and unknown kind |
| Comments | done | DB rejects two authors and no author; visibility defaults to false |
| Attachments | done | reuses the installed `AttachmentsSection` against `/api/attachments` with `entityId: 'orva_tasking:task'` |
| Task drawer UI | done | not yet exercised in a browser — blocked on applying the migration |
| i18n | done | 55 keys, th and en verified equal |

**Deliberately deferred out of Phase 1** (both are Phase 3 concerns, and shipping
them now would mean columns and routes with no caller):

- `orva_tasking_projects.customer_visible` / `customer_label` / `published_at` /
  `published_by`, and `orva_tasking_tasks.customer_visible`.
- The write route and UI for `orva_tasking_task_attachment_flags`. The table
  ships now because it costs nothing to create alongside its siblings; nothing
  writes to it until publishing exists.

### Gate status

| Gate | Result |
|---|---|
| `yarn generate` | pass |
| `yarn typecheck` | pass |
| `yarn lint` | pass — 0 errors, 11 pre-existing warnings |
| `yarn test` | pass — 245 tests, 30 suites (was 235) |
| `yarn ds:check` | **fails on a pre-existing baseline**, not on this phase: 10 findings, all in `orva_documents` and `orva_stock` files this phase did not touch. The 3 findings this phase introduced are resolved with reasoned `.ds-check-ignore` entries (a user-chosen label colour and a computed progress width are runtime data, not palette decisions). |
| `node scripts/verify-rls.mjs` | pending — runs after the migration is applied |
| Browser verification | pending — blocked on the migration |

## Changelog

| Date | Change |
|---|---|
| 2026-09-06 | Skeleton drafted; Q-000…Q-009 raised |
| 2026-09-06 | Q-000…Q-003 answered by the owner; Q-005…Q-009 resolved to the recommended defaults; full spec written |
| 2026-09-06 | Adversarial review applied: task-visibility contradiction fixed; Phase 3 and 5 dependencies corrected to Phase 1; `/api/orva_tasking/tasks` contracts added; TEST-017…020 added for publish, bucket deletion, repeat-without-anchor and reminder cleanup; timeline reschedule given a test and an AC; the Phase 4 rollback exception written down; migration split into its own spec |
