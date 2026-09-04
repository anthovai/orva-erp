import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { SupportSubscription } from '../../data/entities'
import { subscriptionCreateSchema, subscriptionListSchema, subscriptionUpdateSchema } from '../../data/validators'
import {
  annualisedCost, daysUntil, nextRenewal, renewalState, summarise,
  type BillingCycle,
} from '../../lib/subscriptions'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_support.view'] },
  POST: { requireAuth: true, requireFeatures: ['orva_support.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['orva_support.manage'] },
}

const subscriptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  vendor: z.string().nullable(),
  kind: z.string(),
  cost: z.number(),
  currencyCode: z.string(),
  billingCycle: z.string(),
  renewsOn: z.string().nullable(),
  autoRenew: z.boolean(),
  expenseAccountCode: z.string().nullable(),
  customerEntityId: z.string().nullable(),
  customerName: z.string().nullable(),
  quoteId: z.string().nullable(),
  notes: z.string().nullable(),
  status: z.string(),
  lastRenewedAt: z.string().nullable(),
  daysLeft: z.number().nullable(),
  state: z.enum(['lapsed', 'due_soon', 'upcoming']).nullable(),
  annualCost: z.number(),
  updatedAt: z.string(),
})

const listResponseSchema = z.object({
  items: z.array(subscriptionSchema),
  total: z.number(),
  counts: z.object({ lapsed: z.number(), dueSoon: z.number(), annualTotal: z.number(), active: z.number() }),
})

type Row = {
  id: string; name: string; vendor: string | null; kind: string; cost: string; currency_code: string
  billing_cycle: string; renews_on: string | null; auto_renew: boolean; expense_account_code: string | null
  customer_entity_id: string | null; customer_name: string | null; quote_id: string | null
  notes: string | null; status: string; last_renewed_at: string | null; updated_at: string
}

const isoToday = () => new Date().toISOString().slice(0, 10)

const toJson = (row: Row, today: string) => {
  const cycle = row.billing_cycle as BillingCycle
  return {
    id: row.id, name: row.name, vendor: row.vendor, kind: row.kind,
    cost: Number(row.cost), currencyCode: row.currency_code, billingCycle: row.billing_cycle,
    renewsOn: row.renews_on, autoRenew: row.auto_renew, expenseAccountCode: row.expense_account_code,
    customerEntityId: row.customer_entity_id, customerName: row.customer_name, quoteId: row.quote_id,
    notes: row.notes, status: row.status, lastRenewedAt: row.last_renewed_at,
    daysLeft: row.renews_on ? daysUntil(row.renews_on, today) : null,
    state: row.renews_on ? renewalState(row.renews_on, today) : null,
    annualCost: annualisedCost(Number(row.cost), cycle),
    updatedAt: row.updated_at,
  }
}

async function customerNameFor(tem: EntityManager, scope: { tenantId: string; organizationId: string }, entityId: string | null | undefined): Promise<string | null> {
  if (!entityId) return null
  const [entity] = await findWithDecryption(tem, CustomerEntity, { id: entityId }, {}, { tenantId: scope.tenantId, organizationId: scope.organizationId })
  return (entity as { displayName?: string | null } | undefined)?.displayName ?? null
}

/** The register, soonest renewal first, with the yearly run-rate. */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = subscriptionListSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const q = parsed.data
  const today = q.today ?? isoToday()
  const tenantId = auth.tenantId
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const result = await withTenantRls(em, tenantId, async (tem) => {
    const rows = (await tem.execute(
      `select id, name, vendor, kind, cost::text, currency_code, billing_cycle,
              to_char(renews_on, 'YYYY-MM-DD') as renews_on, auto_renew, expense_account_code,
              customer_entity_id, customer_name, quote_id, notes, status,
              last_renewed_at::text, updated_at::text
       from orva_support_subscriptions
       where deleted_at is null and tenant_id = ?::uuid and organization_id = ?::uuid
         and (?::text is null or status = ?::text)
         and (?::text is null or kind = ?::text)
         and (?::text is null or name ilike ?::text or coalesce(vendor, '') ilike ?::text)
       order by renews_on asc nulls last, name asc
       limit 500`,
      [
        tenantId, organizationId,
        q.status ?? null, q.status ?? null,
        q.kind ?? null, q.kind ?? null,
        q.search ? `%${q.search}%` : null, q.search ? `%${q.search}%` : null, q.search ? `%${q.search}%` : null,
      ],
    )) as Row[]
    const all = rows.map((row) => toJson(row, today))
    const counts = summarise(
      rows.map((row) => ({ renewsOn: row.renews_on, cycle: row.billing_cycle as BillingCycle, cost: Number(row.cost), status: row.status })),
      today,
    )
    const items = q.bucket === 'due'
      ? all.filter((row) => row.status === 'active' && (row.state === 'lapsed' || row.state === 'due_soon'))
      : all
    return {
      items,
      total: items.length,
      counts: { ...counts, active: all.filter((row) => row.status === 'active').length },
    }
  })
  return Response.json(result)
}

/** Adds a licence to the register. */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.sub) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = subscriptionCreateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const input = parsed.data
  const scope = { tenantId: auth.tenantId, organizationId }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const created = await withTenantRls(em, scope.tenantId, async (tem) => {
    const now = new Date()
    const row = tem.create(SupportSubscription, {
      tenantId: scope.tenantId, organizationId,
      name: input.name, vendor: input.vendor ?? null, kind: input.kind,
      cost: input.cost.toFixed(4), currencyCode: input.currencyCode.toUpperCase(),
      billingCycle: input.billingCycle, renewsOn: input.renewsOn ?? null,
      autoRenew: input.autoRenew, expenseAccountCode: input.expenseAccountCode ?? null,
      customerEntityId: input.customerEntityId ?? null,
      customerName: await customerNameFor(tem, scope, input.customerEntityId),
      quoteId: input.quoteId ?? null, notes: input.notes ?? null, status: 'active',
      createdBy: auth.sub, createdAt: now, updatedAt: now,
    })
    tem.persist(row)
    await tem.flush()
    return { id: row.id }
  })
  return Response.json({ ok: true, ...created })
}

/** Edits a line, cancels it, or rolls its renewal date one cycle on. */
export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = subscriptionUpdateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const input = parsed.data
  const scope = { tenantId: auth.tenantId, organizationId }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const saved = await withTenantRls(em, scope.tenantId, async (tem) => {
      const row = await tem.findOne(SupportSubscription, { id: input.id, tenantId: scope.tenantId, organizationId, deletedAt: null })
      if (!row) throw Object.assign(new Error('Subscription not found'), { status: 404 })
      if (row.updatedAt.toISOString() !== new Date(input.updatedAt).toISOString()) {
        throw Object.assign(new Error('Conflict — reload and retry'), { status: 409 })
      }
      const now = new Date()
      if (input.name !== undefined) row.name = input.name
      if (input.vendor !== undefined) row.vendor = input.vendor
      if (input.kind !== undefined) row.kind = input.kind
      if (input.cost !== undefined) row.cost = input.cost.toFixed(4)
      if (input.currencyCode !== undefined) row.currencyCode = input.currencyCode.toUpperCase()
      if (input.billingCycle !== undefined) row.billingCycle = input.billingCycle
      if (input.renewsOn !== undefined) row.renewsOn = input.renewsOn
      if (input.autoRenew !== undefined) row.autoRenew = input.autoRenew
      if (input.expenseAccountCode !== undefined) row.expenseAccountCode = input.expenseAccountCode
      if (input.quoteId !== undefined) row.quoteId = input.quoteId
      if (input.notes !== undefined) row.notes = input.notes
      if (input.status !== undefined) row.status = input.status
      if (input.customerEntityId !== undefined) {
        row.customerEntityId = input.customerEntityId
        row.customerName = await customerNameFor(tem, scope, input.customerEntityId)
      }
      // Rolling the date forward last, so it uses whatever cycle this call set.
      if (input.markRenewed) {
        if (!row.renewsOn) throw Object.assign(new Error('ยังไม่มีวันต่ออายุให้เลื่อน'), { status: 400 })
        const next = nextRenewal(row.renewsOn, row.billingCycle as BillingCycle, input.today ?? isoToday())
        if (!next) throw Object.assign(new Error('รายการซื้อครั้งเดียวไม่มีรอบต่ออายุ'), { status: 400 })
        row.renewsOn = next
        row.lastRenewedAt = now
      }
      row.updatedAt = now
      await tem.flush()
      return { id: row.id, renewsOn: row.renewsOn ?? null, status: row.status, updatedAt: row.updatedAt.toISOString() }
    })
    return Response.json({ ok: true, ...saved })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json({ error: error instanceof Error ? error.message : 'Update failed' }, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Support',
  summary: 'Software & subscription register',
  methods: {
    GET: {
      summary: 'Licences, domains and hosting with days to renewal and the yearly run-rate',
      tags: ['Orva Support'],
      query: subscriptionListSchema,
      responses: [{ status: 200, description: 'Register, soonest renewal first.', schema: listResponseSchema }],
    },
    POST: {
      summary: 'Add a licence to the register',
      tags: ['Orva Support'],
      requestBody: { schema: subscriptionCreateSchema },
      responses: [{ status: 200, description: 'Created.', schema: z.object({ ok: z.boolean(), id: z.string() }) }],
    },
    PUT: {
      summary: 'Edit a line, cancel it, or roll its renewal date one cycle on',
      tags: ['Orva Support'],
      requestBody: { schema: subscriptionUpdateSchema },
      responses: [{ status: 200, description: 'Saved.', schema: z.object({ ok: z.boolean(), id: z.string(), renewsOn: z.string().nullable(), status: z.string(), updatedAt: z.string() }) }],
      errors: [{ status: 409, description: 'Stale version', schema: z.object({ error: z.string() }) }],
    },
  },
}
