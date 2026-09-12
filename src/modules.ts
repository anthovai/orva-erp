// Central place to enable modules and their source.
// - id: module id (plural snake_case; special cases: 'auth')
// - from: '@open-mercato/core' | '@app' | custom alias/path in future
// - overrides: optional unified per-app override surface — replace or
//   disable any contract a module presents: AI, routes, events, workers,
//   widgets, notifications, interceptors, setup, ACL, DI, encryption, etc.
//   See `.ai/specs/implemented/2026-05-04-modules-ts-unified-overrides.md` and
//   `apps/docs/docs/framework/modules/overrides.mdx`.
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import type { ModuleOverrides } from '@open-mercato/shared/modules/overrides'
import { officialModuleEntries } from './official-modules.generated'

export type ModuleEntry = {
  id: string
  from?: '@open-mercato/core' | '@app' | string
  overrides?: ModuleOverrides
}

/**
 * Copyable examples for every wired `entry.overrides` domain.
 *
 * This object is intentionally not assigned to any enabled module. Use it as
 * a reference when a downstream app needs to disable or replace contracts
 * from a package-backed module without editing that module's source.
 */
export const moduleOverrideExamples: ModuleOverrides = {
  ai: {
    agents: { 'catalog.catalog_assistant': null },
    tools: { inbox_ops_accept_action: null },
    extensions: [], // additive AiAgentExtension[]; do not use null-map semantics
  },
  routes: {
    api: { 'DELETE /api/example/items': null },
    pages: { '/backend/example/reports': null },
  },
  events: {
    subscribers: { 'example.todo.audit': null },
  },
  workers: { 'example:sync': null },
  widgets: {
    injection: { 'example.sidebar': null },
    components: { 'page:/backend/example': null },
    dashboard: { 'example.kpi': null },
  },
  notifications: {
    types: { 'example.notice': null },
    handlers: { 'example.notice.toast': null },
  },
  interceptors: { 'example.items.interceptor': null },
  commandInterceptors: { 'example.command.interceptor': null },
  enrichers: { 'example.items.enricher': null },
  guards: { 'example.backend.guard': null },
  cli: { 'example seed': null },
  setup: {
    seedExamples: false,
  },
  acl: {
    features: { 'example.manage': null },
  },
  di: { exampleService: null },
  encryption: {
    maps: { 'example:item': null },
  },
  nav: {
    // Prepends sidebar nav group ids ahead of the built-in ordering; unnamed groups keep their
    // current position. Applied beneath role and per-user sidebar preferences.
    groupOrder: ['example.nav.group'],
  },
}

/**
 * Kaiser operating model: the sidebar is organised by the company's seven
 * departments, not by framework module. Upstream pages are moved into these
 * groups through page-metadata overrides below; app modules declare the same
 * keys in their page.meta.ts. Labels live in src/modules/orva/i18n.
 */
const NAV = {
  // Ordered as the work flows: what we sell, what we deliver, what we buy,
  // what we hold, what it does to the books, what we read back, then people,
  // customers and configuration. `NAV_GROUP_ORDER` below is derived from this
  // order, so the sidebar follows the same sequence.
  sales: { pageGroup: 'Sales', pageGroupKey: 'orva.nav.sales' },
  project: { pageGroup: 'Projects', pageGroupKey: 'orva.nav.project' },
  // The vendor registry and everything owed to it. Vendors used to sit under
  // Accounting and purchase orders under Stock — one workflow split across two
  // groups, neither of which owned it.
  purchasing: { pageGroup: 'Purchasing', pageGroupKey: 'orva.nav.purchasing' },
  stock: { pageGroup: 'Stock', pageGroupKey: 'orva.nav.stock' },
  accounting: { pageGroup: 'Accounting', pageGroupKey: 'orva.nav.accounting' },
  // Everything you READ rather than post. Splitting these out is what takes
  // Accounting from nineteen items down to seven.
  reports: { pageGroup: 'Reports & Tax', pageGroupKey: 'orva.nav.reports' },
  hr: { pageGroup: 'HR', pageGroupKey: 'orva.nav.hr' },
  // Everything aimed at a customer who has already bought: support, articles,
  // subscriptions and outbound news. Support and Marketing were two groups of
  // three items and one.
  marketing: { pageGroup: 'Customers', pageGroupKey: 'orva.nav.marketing' },
  // Configuration, which used to be scattered into Sales (document settings,
  // brands) and a two-item "Authentication" group.
  settings: { pageGroup: 'Settings', pageGroupKey: 'orva.nav.settings' },
} as const
const NAV_GROUP_ORDER = Object.values(NAV).map((g) => g.pageGroupKey)
const regroup = (group: keyof typeof NAV, pageOrder: number) => ({ metadata: { ...NAV[group], pageOrder } })
/**
 * `regroup`, for a page that declares its own `pagePriority`.
 *
 * The sidebar comparator resolves `pagePriority ?? pageOrder ?? <large>`, so a
 * page that ships a priority ignores whatever `pageOrder` a regroup gives it
 * and sorts by the number its own module chose for a group it is no longer in.
 * `place` sets both to the same value, which is the only way to state a
 * position that actually holds. `regroup` is left alone so no other group
 * shifts underneath pages that are ordered by an upstream priority today.
 */
const place = (group: keyof typeof NAV, pageOrder: number) => ({
  metadata: { ...NAV[group], pageOrder, pagePriority: pageOrder },
})

export const enabledModules: ModuleEntry[] = [
  { id: 'dashboards', from: '@open-mercato/core', overrides: { nav: { groupOrder: NAV_GROUP_ORDER } } },
  { id: 'auth', from: '@open-mercato/core' },
  { id: 'directory', from: '@open-mercato/core' },
  {
    id: 'customers',
    from: '@open-mercato/core',
    overrides: {
      // Kaiser runs on its own records: `yarn initialize` must never seed demo
      // customers/deals again (2026-09-03 purge). Same for sales/catalog/staff below.
      setup: { seedExamples: false },
      routes: {
        pages: {
          // Orva owns the company create screen: the installed one asks for
          // western-B2B attributes (domain, size bucket, annual revenue,
          // social handles) that a Thai SME never fills, and buries the
          // taxpayer id / branch code a Thai tax invoice requires. Field
          // removal has no extension seam, so the route is replaced. The page
          // still imports upstream's schema, field definitions and payload
          // builder — only the asked-for subset and group order are ours.
          // Metadata is intentionally omitted so the installed guards
          // (customers.companies.manage), title and breadcrumb still apply.
          // (the company create override carries the sales group below, next to its siblings)
          // departments: deals/companies/people are the sales pipeline; tasks and calendar are project work
          '/backend/customers/deals': regroup('sales', 10),
          '/backend/customers/deals/pipeline': regroup('sales', 11),
          '/backend/customers/deals/map': regroup('sales', 12),
          '/backend/customers/deals/create': regroup('sales', 13),
          '/backend/customers/companies': regroup('sales', 14),
          '/backend/customers/companies/create': { ...regroup('sales', 21), load: () => import('@/modules/orva/components/CompanyCreatePage').then((mod) => mod.default) },
          '/backend/customers/people': regroup('sales', 16),
          '/backend/customers/people/create': regroup('sales', 17),
          // Restored on request (2026-09-07) after being closed in a434d67,
          // and correcting the reason I closed it with: there is no
          // `customer_tasks` table, but the screen never needed one — it
          // renders CustomerTodosTable over `customer_todo_links`, and with
          // no rows it shows its empty state, not an error. Verified in the
          // browser. Day-to-day work still lives in orva_tasking.
          '/backend/customer-tasks': place('project', 70),
          // A calendar of deals and their dates. It reads as a work calendar
          // and it is not one — but it is the only calendar on the install,
          // and the owner looks for it beside the work, so it lives here.
          '/backend/calendar': place('project', 60),
        },
      },
    },
  },
  { id: 'perspectives', from: '@open-mercato/core' },
  // create-only leaf in the sidebar; the designer lives under Settings → ออกแบบข้อมูล
  { id: 'entities', from: '@open-mercato/core', overrides: { routes: { pages: { '/backend/entities/user/create': null } } } },
  { id: 'configs', from: '@open-mercato/core' },
  { id: 'query_index', from: '@open-mercato/core' },
  { id: 'audit_logs', from: '@open-mercato/core' },
  // The attachment library was heading a "Media" group by itself.
  { id: 'attachments', from: '@open-mercato/core', overrides: { routes: { pages: { '/backend/storage/attachments': place('settings', 50) } } } },
  {
    id: 'catalog',
    from: '@open-mercato/core',
    overrides: {
      setup: { seedExamples: false },
      routes: {
        pages: {
          '/backend/catalog/products': regroup('stock', 10),
          '/backend/catalog/products/create': regroup('stock', 11),
          '/backend/catalog/categories': regroup('stock', 20),
          '/backend/catalog/categories/create': regroup('stock', 21),
        },
      },
    },
  },
  {
    id: 'sales',
    from: '@open-mercato/core',
    overrides: {
      setup: { seedExamples: false },
      routes: {
        api: {
          // Non-burning document numbers: the create screen previews the next
          // quote/order number instead of claiming it; the claim happens in
          // orva_documents/commands/interceptors.ts when the document is saved.
          // Same response contract; other kinds still claim immediately.
          'POST /api/sales/document-numbers': {
            handler: (req: Request) =>
              import('@/modules/orva_documents/lib/documentNumbersHandler').then((m) => m.POST(req)),
          },
        },
        // Kaiser operating model (spec 2026-09-03-orva-for-kaiser-klowns-operating-model):
        // a service business quoting → billing in งวด → receipts. Sales orders and
        // sales channels are not part of that flow; hide their screens (APIs and
        // data stay, so a tenant that sells through channels can re-enable them).
        pages: {
          '/backend/sales/orders': null,
          '/backend/sales/channels': null,
          '/backend/sales/channels/create': null,
          '/backend/sales/channels/offers': null,
          '/backend/sales/quotes': regroup('sales', 20),
          '/backend/sales/documents/create': regroup('sales', 21),
          '/backend/sales/invoices': regroup('sales', 30),
        },
      },
    },
  },
  // Marventine (phase E): lots, expiry and on-hand come from upstream WMS —
  // one warehouse, one location, no zones/reservations/order assignment. The
  // cost-per-lot, receive-from-OEM-bill, retail sale and COGS posting live in
  // src/modules/orva_stock on top of it.
  {
    id: 'wms',
    from: '@open-mercato/core',
    overrides: {
      setup: { seedExamples: false },
      routes: {
        pages: {
          '/backend/wms': null,
          '/backend/wms/zones': null,
          '/backend/wms/reservations': null,
          '/backend/config/wms': null,
          '/backend/wms/inventory': regroup('stock', 50),
          '/backend/wms/lots': regroup('stock', 60),
          '/backend/wms/movements': regroup('stock', 70),
          '/backend/wms/warehouses': regroup('stock', 80),
          '/backend/wms/locations': regroup('stock', 90),
        },
      },
    },
  },
  // Kaiser operating model: no resource planning, no storefront checkout yet.
  // Disabled (tables untouched) — re-enable one line at a time when needed:
  //   { id: 'planner', from: '@open-mercato/core' }
  //   { id: 'resources', from: '@open-mercato/core' }
  //   { id: 'payment_gateways', from: '@open-mercato/core' }
  //   { id: 'checkout', from: '@open-mercato/checkout' }
  //   { id: 'shipping_carriers', from: '@open-mercato/core' }
  { id: 'api_keys', from: '@open-mercato/core' },
  { id: 'devices', from: '@open-mercato/core' },
  { id: 'dictionaries', from: '@open-mercato/core' },
  { id: 'content', from: '@open-mercato/content' },
  { id: 'onboarding', from: '@open-mercato/onboarding' },
  { id: 'api_docs', from: '@open-mercato/core' },
  {
    id: 'business_rules',
    from: '@open-mercato/core',
    // Kaiser operating model: rule authoring is a builder's tool, not a daily
    // screen for a one-person company — engine stays, screens hidden.
    overrides: {
      routes: {
        pages: {
          '/backend/rules': null,
          '/backend/rules/create': null,
          '/backend/sets': null,
          '/backend/sets/create': null,
          // The rule log was heading a group of one. A group of one is the
          // same problem as the two-item "Authentication" group this
          // restructure removed, so it joins the other admin surfaces.
          '/backend/logs': regroup('settings', 60),
        },
      },
    },
  },
  { id: 'feature_toggles', from: '@open-mercato/core', overrides: { routes: { pages: { '/backend/feature-toggles/global/create': null } } } },
  {
    id: 'workflows',
    from: '@open-mercato/core',
    // Durable workflows keep running for agents; only งานผู้ใช้ (user tasks)
    // stays on the menu — definitions/instances/events are builder screens.
    // Detail pages ([id]) stay reachable from links inside user tasks.
    overrides: {
      routes: {
        pages: {
          '/backend/definitions': null,
          '/backend/definitions/create': null,
          '/backend/definitions/visual-editor': null,
          '/backend/instances': null,
          '/backend/events': null,
          // "User tasks" are approval steps inside durable workflows, not
          // work someone does, and the table holds no rows yet. Restored on
          // request (2026-09-07): it sits last in the group, under its own
          // name งานผู้ใช้, so it reads as a workflow inbox rather than a
          // third thing called "tasks".
          '/backend/tasks': place('project', 80),
        },
      },
    },
  },
  { id: 'search', from: '@open-mercato/search' },
  { id: 'currencies', from: '@open-mercato/core' },
  {
    id: 'staff',
    from: '@open-mercato/core',
    // One-person company: team/leave/timesheet screens hidden; the module stays
    // enabled because orva_hr links employees to team members through its API.
    overrides: {
      setup: { seedExamples: false },
      routes: {
        pages: {
          '/backend/staff/teams': null,
          '/backend/staff/teams/create': null,
          '/backend/staff/team-members': null,
          '/backend/staff/team-members/create': null,
          '/backend/staff/team-roles': null,
          '/backend/staff/team-roles/create': null,
          '/backend/staff/profile/create': null,
          // Own time entries: hours worked are an HR question, but they are
          // logged against the work, and that is where the owner goes looking
          // for them. Restored to โปรเจกต์และงาน on request (2026-09-07).
          '/backend/staff/timesheets': place('project', 90),
          // โครงการ — the timesheet cost centre, restored 2026-09-07.
          //
          // It renders NESTED under บันทึกเวลาของฉัน, not beside it, and that
          // is a deliberate choice (2026-09-07). `buildAdminNav` in
          // @open-mercato/ui makes a route a child when another route's href
          // is a prefix of it AND the two share a groupId — which is exactly
          // what putting 60 and 70 in this group does. `CollapsibleNavSection`
          // then only draws children when the parent is the active route
          // (`showChildren = hasChildren && isActive`), so โครงการ is invisible
          // until บันทึกเวลาของฉัน is opened.
          //
          // The alternatives were to move one of the two into HR, which would
          // undo a placement the owner asked for, or to build an Orva route at
          // a non-nested path. The owner chose to keep both here and live with
          // the nesting. Do not "fix" this by splitting the groups without
          // asking — and note `isActive` uses startsWith, so once you are on
          // โครงการ the parent stays open around it.
          //
          // Correcting myself twice over. I first hid this saying it "was
          // never one of the seven that showed in this group": it was. Its
          // page.meta carries a hand-built folder SVG as its icon, which is
          // exactly the folder beside "โครงการ" in the menu the owner is
          // working from. And the reason I gave for hiding rather than moving
          // it — that moving it "did not render it for a reason I could not
          // establish" — was me not looking: the page is gated on
          // `staff.timesheets.projects.view`, granted to the employee role,
          // and the account in use passes only because it is super admin.
          //
          // The four staff_time_* tables are still empty, so this screen has
          // nothing to show yet. That is a reason to leave it visible and let
          // it say so, not a reason to close a door the owner walked through.
          //
          // The create page is navHidden upstream; it is grouped only so its
          // breadcrumb sits under the same heading.
          '/backend/staff/timesheets/projects': place('project', 100),
          '/backend/staff/timesheets/projects/create': place('project', 101),
          '/backend/staff/leave-requests': regroup('hr', 40),
          '/backend/staff/leave-requests/create': regroup('hr', 41),
          '/backend/staff/my-leave-requests': regroup('hr', 50),
          '/backend/staff/my-leave-requests/create': regroup('hr', 51),
          '/backend/staff/my-availability': regroup('hr', 60),
        },
      },
    },
  },
  { id: 'events', from: '@open-mercato/events' },
  { id: 'notifications', from: '@open-mercato/core' },
  { id: 'progress', from: '@open-mercato/core' },
  { id: 'integrations', from: '@open-mercato/core' },
  { id: 'data_sync', from: '@open-mercato/core' },
  { id: 'sync_excel', from: '@open-mercato/core' },
  { id: 'messages', from: '@open-mercato/core', overrides: { routes: { pages: { '/backend/messages': regroup('marketing', 60), '/backend/messages/compose': regroup('marketing', 61) } } } },
  // Communication channels hub (SPEC-045d) — bridges external chat/email channels
  // (Slack, WhatsApp, Email) to the unified Messages inbox. Provider packages
  // (channel-slack, channel-whatsapp, future email providers) register adapters here.
  {
    id: 'communication_channels',
    from: '@open-mercato/core',
    overrides: { routes: { pages: { '/backend/communication_channels/channels': regroup('marketing', 70) } } },
  },
  // Push notification rails — `push` delivery strategy + delivery log + send-push worker.
  // Fans out to `devices` tokens and sends through the `communication_channels` hub.
  { id: 'push_notifications', from: '@open-mercato/core' },
  { id: 'ai_assistant', from: '@open-mercato/ai-assistant' },
  { id: 'translations', from: '@open-mercato/core' },
  { id: 'scheduler', from: '@open-mercato/scheduler' },
  { id: 'inbox_ops', from: '@open-mercato/core', overrides: { routes: { pages: { '/backend/inbox-ops': regroup('marketing', 20) } } } },
  // Per-user email channels for the Communications Hub (SPEC-045d / email
  // integration spec). Each provider package registers its `ChannelAdapter`
  // at import time via `setup.ts`; the hub picks them up by `providerKey`.
  { id: 'channel_imap', from: '@open-mercato/channel-imap' },
  { id: 'channel_gmail', from: '@open-mercato/channel-gmail' },
  { id: 'webhooks', from: '@open-mercato/webhooks' },
  { id: 'customer_accounts', from: '@open-mercato/core', overrides: { setup: { seedExamples: false } } },
  { id: 'portal', from: '@open-mercato/core' },
  { id: 'ratelimit_probe', from: '@app' },
]

// Official modules activated via official-modules.json / official-modules.local.json
// (managed by `yarn official-modules`; backed by the external/official-modules submodule).
for (const entry of officialModuleEntries) {
  if (!enabledModules.some((existing) => existing.id === entry.id)) enabledModules.push(entry)
}

if (enabledModules.some((entry) => entry.id === 'example')) {
  enabledModules.push({ id: 'example_customers_sync', from: '@app' })
}

if (parseBooleanWithDefault(process.env.OM_ENABLE_STORAGE_S3, false)) {
  enabledModules.push({ id: 'storage_s3', from: '@open-mercato/storage-s3' })
}

// Orva policy: @open-mercato/enterprise is proprietary (no commercial/SaaS use)
// and must never be wired in. SSO/MFA/record-locking will be reimplemented
// clean-room as @orva/* modules through public extension points.

// Orva trim (2026-08-30): upstream modules Orva does not use are disabled to
// keep the product surface (sidebar, AI launcher, settings) focused. Their DB
// tables are untouched, so re-enabling is a one-line revert:
//   { id: 'warranty_claims', from: '@open-mercato/core' }
//   { id: 'eudr', from: '@open-mercato/core' }               // EU deforestation compliance
//   { id: 'sync_akeneo', from: '@open-mercato/sync-akeneo' } // Akeneo PIM sync
//   { id: 'gateway_stripe', from: '@open-mercato/gateway-stripe' }
//   { id: 'channel_apns', from: '@open-mercato/channel-apns' }
//   { id: 'channel_expo', from: '@open-mercato/channel-expo' }
//   { id: 'channel_fcm', from: '@open-mercato/channel-fcm' }

// Orva domain modules.
enabledModules.push({ id: 'orva_party', from: '@app' })
enabledModules.push({ id: 'orva_finance', from: '@app' })
enabledModules.push({ id: 'orva_hr', from: '@app' })
// Clean-room TOTP MFA + OIDC SSO (spec: .ai/specs/2026-08-30-orva-mfa-sso-clean-room.md).
enabledModules.push({ id: 'orva_mfa', from: '@app' })
enabledModules.push({ id: 'orva_sso', from: '@app' })
// Printable Thai business documents (spec: .ai/specs/2026-08-31-orva-documents-thai-print.md).
enabledModules.push({ id: 'orva_documents', from: '@app' })
// Marventine product line on top of WMS lots: lot costs, receive from OEM bill,
// retail sale + stock issue, valuation, COGS posting (operating-model spec, phase E).
enabledModules.push({ id: 'orva_stock', from: '@app' })
// ใบสั่งซื้อ — the commitment to buy, which neither the ledger (a liability)
// nor the warehouse (a quantity) owns. Registered after orva_stock because
// receiving goods against an order calls that module's receive route, and
// after orva_finance for the same reason on the billing side.
// Spec: .ai/specs/2026-09-08-orva-purchasing-and-delivery-note.md
enabledModules.push({ id: 'orva_purchasing', from: '@app' })
// Customer support for shipped software (benchmark spec F0 gap #7).
enabledModules.push({ id: 'orva_support', from: '@app' })
// การตลาด: consent per CRM contact (custom fields on customers:customer_entity),
// public unsubscribe link, broadcasts through the installed messages module.
// Spec: .ai/specs/2026-09-10-orva-phase-h-department-completion.md (H2)
enabledModules.push({ id: 'orva_marketing', from: '@app' })
enabledModules.push({ id: 'orva_tasking', from: '@app' })
// The seam between the work and the hours: keeps โครงการ (staff_time_projects)
// in step with โปรเจกต์ (orva_tasking_projects). Registered after orva_tasking
// because it listens to that module's events.
// Spec: .ai/specs/2026-09-07-orva-time-tracking-ownership-and-project-sync.md
enabledModules.push({ id: 'orva_time', from: '@app' })

// Orva branding: registered LAST so its i18n overrides every module's defaults
// (dictionary merge is last-write-wins across enabledModules order).
enabledModules.push({ id: 'orva', from: '@app' })
