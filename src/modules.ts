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
  sales: { pageGroup: 'Sales', pageGroupKey: 'orva.nav.sales' },
  marketing: { pageGroup: 'Marketing', pageGroupKey: 'orva.nav.marketing' },
  project: { pageGroup: 'Projects', pageGroupKey: 'orva.nav.project' },
  stock: { pageGroup: 'Stock', pageGroupKey: 'orva.nav.stock' },
  accounting: { pageGroup: 'Accounting', pageGroupKey: 'orva.nav.accounting' },
  hr: { pageGroup: 'HR', pageGroupKey: 'orva.nav.hr' },
  it: { pageGroup: 'IT Support', pageGroupKey: 'orva.nav.it' },
} as const
const NAV_GROUP_ORDER = Object.values(NAV).map((g) => g.pageGroupKey)
const regroup = (group: keyof typeof NAV, pageOrder: number) => ({ metadata: { ...NAV[group], pageOrder } })

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
          '/backend/customers/companies': regroup('sales', 20),
          '/backend/customers/companies/create': { ...regroup('sales', 21), load: () => import('@/modules/orva/components/CompanyCreatePage').then((mod) => mod.default) },
          '/backend/customers/people': regroup('sales', 30),
          '/backend/customers/people/create': regroup('sales', 31),
          '/backend/customer-tasks': regroup('project', 10),
          '/backend/calendar': regroup('project', 20),
          '/backend/config/customers/deals': regroup('it', 70),
        },
      },
    },
  },
  { id: 'perspectives', from: '@open-mercato/core' },
  // create-only leaf in the sidebar; the designer lives under Settings → ออกแบบข้อมูล
  { id: 'entities', from: '@open-mercato/core', overrides: { routes: { pages: { '/backend/entities/user/create': null } } } },
  { id: 'configs', from: '@open-mercato/core' },
  { id: 'query_index', from: '@open-mercato/core' },
  { id: 'audit_logs', from: '@open-mercato/core', overrides: { routes: { pages: { '/backend/audit-logs': regroup('it', 20) } } } },
  { id: 'attachments', from: '@open-mercato/core', overrides: { routes: { pages: { '/backend/storage/attachments': regroup('it', 10) } } } },
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
          '/backend/sales/quotes': regroup('sales', 40),
          '/backend/sales/documents/create': regroup('sales', 50),
          '/backend/sales/invoices': regroup('sales', 60),
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
          '/backend/wms/inventory': regroup('stock', 40),
          '/backend/wms/lots': regroup('stock', 50),
          '/backend/wms/movements': regroup('stock', 60),
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
  { id: 'api_docs', from: '@open-mercato/core', overrides: { routes: { pages: { '/backend/docs': regroup('it', 30) } } } },
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
          '/backend/tasks': regroup('project', 30),
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
          // benchmark F0: timesheets belong to project work, leave to HR
          '/backend/staff/timesheets': regroup('project', 40),
          '/backend/staff/timesheets/projects': regroup('project', 50),
          '/backend/staff/timesheets/projects/create': regroup('project', 51),
          '/backend/staff/leave-requests': regroup('hr', 30),
          '/backend/staff/leave-requests/create': regroup('hr', 31),
          '/backend/staff/my-leave-requests': regroup('hr', 40),
          '/backend/staff/my-leave-requests/create': regroup('hr', 41),
          '/backend/staff/my-availability': regroup('hr', 50),
        },
      },
    },
  },
  { id: 'events', from: '@open-mercato/events' },
  { id: 'notifications', from: '@open-mercato/core', overrides: { routes: { pages: { '/backend/profile/notification-preferences': regroup('it', 60) } } } },
  { id: 'progress', from: '@open-mercato/core' },
  { id: 'integrations', from: '@open-mercato/core' },
  { id: 'data_sync', from: '@open-mercato/core' },
  { id: 'sync_excel', from: '@open-mercato/core' },
  { id: 'messages', from: '@open-mercato/core', overrides: { routes: { pages: { '/backend/messages': regroup('marketing', 10), '/backend/messages/compose': regroup('marketing', 20) } } } },
  // Communication channels hub (SPEC-045d) — bridges external chat/email channels
  // (Slack, WhatsApp, Email) to the unified Messages inbox. Provider packages
  // (channel-slack, channel-whatsapp, future email providers) register adapters here.
  {
    id: 'communication_channels',
    from: '@open-mercato/core',
    overrides: { routes: { pages: { '/backend/communication_channels/channels': regroup('marketing', 30), '/backend/profile/communication-channels': regroup('it', 50) } } },
  },
  // Push notification rails — `push` delivery strategy + delivery log + send-push worker.
  // Fans out to `devices` tokens and sends through the `communication_channels` hub.
  { id: 'push_notifications', from: '@open-mercato/core' },
  { id: 'ai_assistant', from: '@open-mercato/ai-assistant' },
  { id: 'translations', from: '@open-mercato/core' },
  { id: 'scheduler', from: '@open-mercato/scheduler' },
  { id: 'inbox_ops', from: '@open-mercato/core', overrides: { routes: { pages: { '/backend/inbox-ops': regroup('marketing', 40) } } } },
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

// Orva branding: registered LAST so its i18n overrides every module's defaults
// (dictionary merge is last-write-wins across enabledModules order).
enabledModules.push({ id: 'orva', from: '@app' })
