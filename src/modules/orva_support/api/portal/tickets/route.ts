import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { SupportReply, SupportTicket } from '../../../data/entities'
import { portalTicketCreateSchema, portalTicketQuerySchema } from '../../../data/validators'
import { ticketNumber } from '../../../lib/tickets'
import { customerNameFor } from '../../../lib/customerName'

// The route authenticates the customer itself; staff auth does not apply.
export const metadata = {
  GET: { requireAuth: false },
  POST: { requireAuth: false },
}

const ticketSchema = z.object({
  id: z.string(), ticketNo: z.string(), subject: z.string(), kind: z.string(), status: z.string(),
  createdAt: z.string(), updatedAt: z.string(), lastReplyAt: z.string().nullable(), replyCount: z.number(),
})
const messageSchema = z.object({
  id: z.string(), author: z.enum(['staff', 'customer']), body: z.string(), createdAt: z.string(),
  attachments: z.array(z.object({ id: z.string(), fileName: z.string() })),
})

/**
 * A customer's own tickets, and the conversation on one of them.
 *
 * Scope is the customer entity on the session — never an id from the request
 * — so a ticket that is not theirs reads as "not found" exactly like one that
 * does not exist. Internal notes are filtered out: `author = 'note'` is what
 * staff write to each other, and the portal is not the place it appears.
 */
export async function GET(req: Request) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const customerEntityId = auth.customerEntityId ?? null
  if (!customerEntityId) return Response.json({ linked: false, tickets: [] })
  const parsed = portalTicketQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  return withTenantRls(em, scope.tenantId, async (tem) => {
    const tickets = await tem.find(
      SupportTicket,
      { ...scope, customerEntityId, deletedAt: null },
      { orderBy: { createdAt: 'desc' }, limit: 100 },
    )
    if (!parsed.data.ticketId) {
      const counts = tickets.length
        ? (await tem.execute(
            `select ticket_id::text as id, count(*)::int as n, max(created_at) as last_at
             from orva_support_replies
             where tenant_id = ?::uuid and deleted_at is null and author <> 'note'
               and ticket_id = any(?::uuid[])
             group by 1`,
            [scope.tenantId, `{${tickets.map((t) => t.id).join(',')}}`],
          )) as Array<{ id: string; n: number; last_at: Date | string }>
        : []
      const byTicket = new Map(counts.map((row) => [row.id, row]))
      return Response.json({
        linked: true,
        tickets: tickets.map((ticket) => {
          const count = byTicket.get(String(ticket.id))
          return {
            id: String(ticket.id), ticketNo: ticket.ticketNo, subject: ticket.subject,
            kind: ticket.kind, status: ticket.status,
            createdAt: ticket.createdAt.toISOString(), updatedAt: ticket.updatedAt.toISOString(),
            lastReplyAt: count?.last_at ? new Date(count.last_at).toISOString() : null,
            replyCount: count?.n ?? 0,
          }
        }),
      })
    }

    const ticket = tickets.find((row) => String(row.id) === parsed.data.ticketId)
    if (!ticket) return Response.json({ error: 'Not found' }, { status: 404 })
    const replies = await tem.find(
      SupportReply,
      { ticketId: ticket.id, tenantId: scope.tenantId, deletedAt: null, author: { $ne: 'note' } },
      { orderBy: { createdAt: 'asc' } },
    )
    // Two things the installed `attachments` schema decides for us: `record_id`
    // is a text column, so the id binds as text and not as a uuid; and there is
    // no soft-delete column — a removed attachment is a removed row.
    const attachmentRows = (await tem.execute(
      `select id::text as attachment_id, file_name
       from attachments
       where tenant_id = ?::uuid and entity_id = 'orva_support:ticket' and record_id = ?
       order by created_at`,
      [scope.tenantId, String(ticket.id)],
    )) as Array<{ attachment_id: string; file_name: string }>

    return Response.json({
      linked: true,
      ticket: {
        id: String(ticket.id), ticketNo: ticket.ticketNo, subject: ticket.subject,
        kind: ticket.kind, status: ticket.status, createdAt: ticket.createdAt.toISOString(),
      },
      // The opening description reads as the customer's first message.
      messages: [
        ...(ticket.description
          ? [{ id: `${ticket.id}-opening`, author: 'customer' as const, body: ticket.description, createdAt: ticket.createdAt.toISOString(), attachments: [] }]
          : []),
        ...replies.map((reply) => ({
          id: String(reply.id),
          author: reply.author === 'customer' ? ('customer' as const) : ('staff' as const),
          body: reply.body,
          createdAt: reply.createdAt.toISOString(),
          attachments: [] as Array<{ id: string; fileName: string }>,
        })),
      ],
      attachments: attachmentRows.map((row) => ({ id: row.attachment_id, fileName: row.file_name })),
    })
  })
}

/**
 * The customer opens a ticket themselves.
 *
 * Numbered from the same sequence the queue screen uses, so TCK-000007 means
 * the same thing however it arrived, and marked `source = 'portal'` so the
 * owner can see where their work comes from. The customer cannot set priority
 * or a due date: those are the desk's judgement, not the requester's.
 */
export async function POST(req: Request) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const customerEntityId = auth.customerEntityId ?? null
  if (!customerEntityId) return Response.json({ error: 'This account is not linked to a customer record' }, { status: 403 })
  const parsed = portalTicketCreateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const input = parsed.data

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const created = await withTenantRls(em, scope.tenantId, async (tem) => {
    const seqRows = (await tem.execute(
      `insert into orva_gl_sequences as s (tenant_id, organization_id, kind, next_value)
       values (?, ?, 'support_ticket', 2)
       on conflict (tenant_id, organization_id, kind)
       do update set next_value = s.next_value + 1
       returning next_value - 1 as seq`,
      [scope.tenantId, scope.organizationId],
    )) as Array<{ seq: string | number }>
    const now = new Date()
    const ticket = tem.create(SupportTicket, {
      tenantId: scope.tenantId, organizationId: scope.organizationId,
      ticketNo: ticketNumber(Number(seqRows[0]?.seq ?? 1)),
      subject: input.subject, description: input.description,
      kind: input.kind ?? 'question', priority: 'normal', status: 'open',
      customerEntityId,
      // The company, like every other row in the queue; who reported it is
      // the contact email, which is the account's own.
      customerName: await customerNameFor(tem, scope, customerEntityId),
      contactEmail: auth.email ?? null,
      quoteId: null,
      source: 'portal',
      dueOn: null, minutesSpent: 0,
      createdBy: null, createdAt: now, updatedAt: now,
    })
    tem.persist(ticket)
    await tem.flush()
    return { id: String(ticket.id), ticketNo: ticket.ticketNo }
  })
  return Response.json({ ok: true, ...created }, { status: 201 })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Support',
  summary: 'Portal — the customer\'s own tickets',
  methods: {
    GET: {
      summary: "The signed-in customer's tickets, or one ticket's conversation without internal notes",
      tags: ['Orva Support'],
      query: portalTicketQuerySchema,
      responses: [{ status: 200, description: 'Tickets or one conversation.', schema: z.object({ linked: z.boolean(), tickets: z.array(ticketSchema).optional(), messages: z.array(messageSchema).optional() }) }],
    },
    POST: {
      summary: 'Open a ticket from the portal, numbered from the same series as the desk',
      tags: ['Orva Support'],
      requestBody: { schema: portalTicketCreateSchema },
      responses: [{ status: 201, description: 'The new ticket.', schema: z.object({ ok: z.boolean(), id: z.string(), ticketNo: z.string() }) }],
    },
  },
}
