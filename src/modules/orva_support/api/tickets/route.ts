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
import { SupportTicket } from '../../data/entities'
import { OPEN_STATUSES, ticketCreateSchema, ticketListSchema, ticketUpdateSchema } from '../../data/validators'
import { ageOf, canTransition, queueOrder, stampsFor, ticketNumber, type TicketStatus } from '../../lib/tickets'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_support.view'] },
  POST: { requireAuth: true, requireFeatures: ['orva_support.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['orva_support.manage'] },
}

const ticketSchema = z.object({
  id: z.string(),
  ticketNo: z.string(),
  subject: z.string(),
  kind: z.string(),
  priority: z.string(),
  status: z.string(),
  customerEntityId: z.string().nullable(),
  customerName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  quoteId: z.string().nullable(),
  dueOn: z.string().nullable(),
  minutesSpent: z.number(),
  ageHours: z.number(),
  responseHours: z.number().nullable(),
  awaitingFirstResponse: z.boolean(),
  daysOverdue: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const listResponseSchema = z.object({
  items: z.array(ticketSchema),
  total: z.number(),
  counts: z.object({ open: z.number(), waiting: z.number(), overdue: z.number(), unanswered: z.number(), minutesOpen: z.number() }),
})

type Row = {
  id: string; ticket_no: string; subject: string; description: string | null; kind: string; priority: string; status: string
  customer_entity_id: string | null; customer_name: string | null; contact_email: string | null; quote_id: string | null
  due_on: string | null; minutes_spent: number; first_response_at: string | null; resolved_at: string | null
  created_at: string; updated_at: string
}

const toJson = (row: Row) => {
  const age = ageOf({ createdAt: row.created_at, firstResponseAt: row.first_response_at, resolvedAt: row.resolved_at, dueOn: row.due_on, status: row.status as TicketStatus })
  return {
    id: row.id, ticketNo: row.ticket_no, subject: row.subject, description: row.description,
    kind: row.kind, priority: row.priority, status: row.status,
    customerEntityId: row.customer_entity_id, customerName: row.customer_name, contactEmail: row.contact_email,
    quoteId: row.quote_id, dueOn: row.due_on, minutesSpent: row.minutes_spent,
    createdAt: row.created_at, updatedAt: row.updated_at, ...age,
  }
}

/** Resolves a CRM company/person name through the decrypting finder. */
async function customerNameFor(tem: EntityManager, scope: { tenantId: string; organizationId: string }, entityId: string | null | undefined): Promise<string | null> {
  if (!entityId) return null
  const [entity] = await findWithDecryption(tem, CustomerEntity, { id: entityId }, {}, { tenantId: scope.tenantId, organizationId: scope.organizationId })
  return (entity as { displayName?: string | null } | undefined)?.displayName ?? null
}

/** The support queue: open tickets first, urgent and overdue on top. */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = ticketListSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const q = parsed.data
  const tenantId = auth.tenantId
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const result = await withTenantRls(em, tenantId, async (tem) => {
    const rows = (await tem.execute(
      `select id, ticket_no, subject, description, kind, priority, status, customer_entity_id, customer_name, contact_email,
              quote_id, to_char(due_on, 'YYYY-MM-DD') as due_on, minutes_spent,
              first_response_at::text, resolved_at::text, created_at::text, updated_at::text
       from orva_support_tickets
       where deleted_at is null and tenant_id = ?::uuid and organization_id = ?::uuid
         and (?::text is null or status = ?::text)
         and (?::boolean is false or status = any(?::text[]))
         and (?::text is null or kind = ?::text)
         and (?::text is null or priority = ?::text)
         and (?::uuid is null or customer_entity_id = ?::uuid)
         and (?::uuid is null or quote_id = ?::uuid)
         and (?::text is null or subject ilike ?::text or ticket_no ilike ?::text or coalesce(customer_name, '') ilike ?::text)
       order by created_at desc
       limit 500`,
      [
        tenantId, organizationId,
        q.status ?? null, q.status ?? null,
        q.bucket === 'open' && !q.status, `{${OPEN_STATUSES.join(',')}}`,
        q.kind ?? null, q.kind ?? null,
        q.priority ?? null, q.priority ?? null,
        q.customerEntityId ?? null, q.customerEntityId ?? null,
        (q as { quoteId?: string }).quoteId ?? null, (q as { quoteId?: string }).quoteId ?? null,
        q.search ? `%${q.search}%` : null, q.search ? `%${q.search}%` : null, q.search ? `%${q.search}%` : null, q.search ? `%${q.search}%` : null,
      ],
    )) as Row[]
    const items = rows.map(toJson).sort(queueOrder)
    // MikroORM's driver binds `?` placeholders; numbered ($1) params are not
    // rewritten, so the open-status array is passed once per filter.
    const open = `{${OPEN_STATUSES.join(',')}}`
    const [counts] = (await tem.execute(
      `select
         count(*) filter (where status = any(?::text[]))::int as open,
         count(*) filter (where status = 'waiting_customer')::int as waiting,
         count(*) filter (where status = any(?::text[]) and due_on is not null and due_on < current_date)::int as overdue,
         count(*) filter (where status = any(?::text[]) and first_response_at is null)::int as unanswered,
         coalesce(sum(minutes_spent) filter (where status = any(?::text[])), 0)::int as minutes_open
       from orva_support_tickets where deleted_at is null and tenant_id = ?::uuid and organization_id = ?::uuid`,
      [open, open, open, open, tenantId, organizationId],
    )) as Array<{ open: number; waiting: number; overdue: number; unanswered: number; minutes_open: number }>
    const page = items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize)
    return {
      items: page,
      total: items.length,
      counts: { open: counts?.open ?? 0, waiting: counts?.waiting ?? 0, overdue: counts?.overdue ?? 0, unanswered: counts?.unanswered ?? 0, minutesOpen: counts?.minutes_open ?? 0 },
    }
  })
  return Response.json(result)
}

/** Opens a ticket, numbered TCK-000001 from the finance sequence table. */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.sub) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = ticketCreateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const input = parsed.data
  const scope = { tenantId: auth.tenantId, organizationId }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const created = await withTenantRls(em, scope.tenantId, async (tem) => {
    const seqRows = (await tem.execute(
      `insert into orva_gl_sequences as s (tenant_id, organization_id, kind, next_value)
       values (?, ?, 'support_ticket', 2)
       on conflict (tenant_id, organization_id, kind)
       do update set next_value = s.next_value + 1
       returning next_value - 1 as seq`,
      [scope.tenantId, organizationId],
    )) as Array<{ seq: string | number }>
    const now = new Date()
    const ticket = tem.create(SupportTicket, {
      tenantId: scope.tenantId, organizationId,
      ticketNo: ticketNumber(Number(seqRows[0]?.seq ?? 1)),
      subject: input.subject, description: input.description ?? null,
      kind: input.kind, priority: input.priority, status: 'open',
      customerEntityId: input.customerEntityId ?? null,
      customerName: await customerNameFor(tem, scope, input.customerEntityId),
      contactEmail: input.contactEmail ?? null, quoteId: input.quoteId ?? null,
      // Opened by hand on the queue screen; the inbound-email subscriber is
      // the only thing that writes 'email'.
      source: 'manual',
      dueOn: input.dueOn ?? null, minutesSpent: 0,
      createdBy: auth.sub, createdAt: now, updatedAt: now,
    })
    tem.persist(ticket)
    await tem.flush()
    return { id: ticket.id, ticketNo: ticket.ticketNo }
  })
  return Response.json({ ok: true, ...created })
}

/** Edits a ticket, including its status (transition-checked, optimistic-locked). */
export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = ticketUpdateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const input = parsed.data
  const scope = { tenantId: auth.tenantId, organizationId }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const saved = await withTenantRls(em, scope.tenantId, async (tem) => {
      const ticket = await tem.findOne(SupportTicket, { id: input.id, tenantId: scope.tenantId, organizationId, deletedAt: null })
      if (!ticket) throw Object.assign(new Error('Ticket not found'), { status: 404 })
      if (ticket.updatedAt.toISOString() !== new Date(input.updatedAt).toISOString()) {
        throw Object.assign(new Error('Conflict — reload and retry'), { status: 409 })
      }
      const now = new Date()
      if (input.status && input.status !== ticket.status) {
        if (!canTransition(ticket.status as TicketStatus, input.status)) {
          throw Object.assign(new Error(`ไม่สามารถเปลี่ยนสถานะจาก ${ticket.status} เป็น ${input.status}`), { status: 400 })
        }
        Object.assign(ticket, stampsFor(input.status, now))
        ticket.status = input.status
      }
      if (input.subject !== undefined) ticket.subject = input.subject
      if (input.description !== undefined) ticket.description = input.description
      if (input.kind !== undefined) ticket.kind = input.kind
      if (input.priority !== undefined) ticket.priority = input.priority
      if (input.contactEmail !== undefined) ticket.contactEmail = input.contactEmail
      if (input.quoteId !== undefined) ticket.quoteId = input.quoteId
      if (input.dueOn !== undefined) ticket.dueOn = input.dueOn
      if (input.customerEntityId !== undefined) {
        ticket.customerEntityId = input.customerEntityId
        ticket.customerName = await customerNameFor(tem, scope, input.customerEntityId)
      }
      ticket.updatedAt = now
      await tem.flush()
      return { id: ticket.id, status: ticket.status, updatedAt: ticket.updatedAt.toISOString() }
    })
    return Response.json({ ok: true, ...saved })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json({ error: error instanceof Error ? error.message : 'Update failed' }, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Support',
  summary: 'Support tickets',
  methods: {
    GET: { summary: 'The support queue with counts (open, waiting, overdue, unanswered)', tags: ['Orva Support'], query: ticketListSchema, responses: [{ status: 200, description: 'Tickets.', schema: listResponseSchema }] },
    POST: { summary: 'Open a ticket', tags: ['Orva Support'], requestBody: { schema: ticketCreateSchema }, responses: [{ status: 200, description: 'Created.', schema: z.object({ ok: z.boolean(), id: z.string(), ticketNo: z.string() }) }] },
    PUT: { summary: 'Edit a ticket or move its status', tags: ['Orva Support'], requestBody: { schema: ticketUpdateSchema }, responses: [{ status: 200, description: 'Saved.', schema: z.object({ ok: z.boolean(), id: z.string(), status: z.string(), updatedAt: z.string() }) }], errors: [{ status: 409, description: 'Stale version', schema: z.object({ error: z.string() }) }] },
  },
}
