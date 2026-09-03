import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { SupportReply, SupportTicket } from '../../data/entities'
import { replyCreateSchema, ticketQuerySchema } from '../../data/validators'
import { canTransition, stampsFor, type TicketStatus } from '../../lib/tickets'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_support.view'] },
  POST: { requireAuth: true, requireFeatures: ['orva_support.manage'] },
}

const replySchema = z.object({
  id: z.string(), author: z.string(), body: z.string(), minutesSpent: z.number(), createdAt: z.string(),
})

/** The ticket's thread, oldest first. */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = ticketQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const rows = (await withTenantRls(em, auth.tenantId, (tem) => tem.execute(
    `select id, author, body, minutes_spent, created_at::text
     from orva_support_replies
     where deleted_at is null and tenant_id = ?::uuid and ticket_id = ?::uuid
     order by created_at`,
    [auth.tenantId, parsed.data.id],
  ))) as Array<{ id: string; author: string; body: string; minutes_spent: number; created_at: string }>
  return Response.json({ items: rows.map((r) => ({ id: r.id, author: r.author, body: r.body, minutesSpent: r.minutes_spent, createdAt: r.created_at })) })
}

/**
 * Adds a reply. A staff reply stamps first-response time (once), minutes roll
 * up onto the ticket, and an optional status move happens in the same
 * transaction so the thread and the state never disagree.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.sub) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = replyCreateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const input = parsed.data
  const tenantId = auth.tenantId
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const saved = await withTenantRls(em, tenantId, async (tem) => {
      const ticket = await tem.findOne(SupportTicket, { id: input.ticketId, tenantId, organizationId, deletedAt: null })
      if (!ticket) throw Object.assign(new Error('Ticket not found'), { status: 404 })
      const now = new Date()
      tem.persist(tem.create(SupportReply, {
        tenantId, organizationId, ticketId: ticket.id, author: input.author,
        body: input.body, minutesSpent: input.minutesSpent, createdBy: auth.sub, createdAt: now, updatedAt: now,
      }))
      ticket.minutesSpent += input.minutesSpent
      if (input.author === 'staff' && !ticket.firstResponseAt) ticket.firstResponseAt = now
      if (input.status && input.status !== ticket.status) {
        if (!canTransition(ticket.status as TicketStatus, input.status)) {
          throw Object.assign(new Error(`ไม่สามารถเปลี่ยนสถานะจาก ${ticket.status} เป็น ${input.status}`), { status: 400 })
        }
        Object.assign(ticket, stampsFor(input.status, now))
        ticket.status = input.status
      } else if (input.author === 'customer' && ticket.status === 'waiting_customer') {
        // the customer answered — it is back on us
        ticket.status = 'in_progress'
      }
      ticket.updatedAt = now
      await tem.flush()
      return { ticketId: ticket.id, status: ticket.status, minutesSpent: ticket.minutesSpent, updatedAt: ticket.updatedAt.toISOString() }
    })
    return Response.json({ ok: true, ...saved })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json({ error: error instanceof Error ? error.message : 'Reply failed' }, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Support',
  summary: 'Ticket replies',
  methods: {
    GET: { summary: "One ticket's thread", tags: ['Orva Support'], query: ticketQuerySchema, responses: [{ status: 200, description: 'Replies.', schema: z.object({ items: z.array(replySchema) }) }] },
    POST: { summary: 'Add a reply, log minutes, optionally move the status', tags: ['Orva Support'], requestBody: { schema: replyCreateSchema }, responses: [{ status: 200, description: 'Added.', schema: z.object({ ok: z.boolean(), ticketId: z.string(), status: z.string(), minutesSpent: z.number() }) }] },
  },
}
