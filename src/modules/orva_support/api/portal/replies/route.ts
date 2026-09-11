import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { SupportReply, SupportTicket } from '../../../data/entities'
import { portalReplySchema } from '../../../data/validators'

// The route authenticates the customer itself; staff auth does not apply.
export const metadata = {
  POST: { requireAuth: false },
}

/**
 * The customer answers on their own ticket.
 *
 * Two side effects that matter to the desk: a closed or resolved ticket comes
 * back to `waiting` on the desk rather than staying shut, because a customer
 * who writes again has not finished; and the ticket's `updated_at` moves, so
 * the queue sorts it where the work is. Minutes are not logged — a customer's
 * typing is not billable time.
 */
export async function POST(req: Request) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const customerEntityId = auth.customerEntityId ?? null
  if (!customerEntityId) return Response.json({ error: 'Not found' }, { status: 404 })
  const parsed = portalReplySchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const outcome = await withTenantRls(em, scope.tenantId, async (tem) => {
    const ticket = await tem.findOne(SupportTicket, {
      id: parsed.data.ticketId, ...scope, customerEntityId, deletedAt: null,
    })
    if (!ticket) return null
    const now = new Date()
    tem.persist(tem.create(SupportReply, {
      tenantId: scope.tenantId, organizationId: scope.organizationId,
      ticketId: ticket.id, author: 'customer', body: parsed.data.body,
      minutesSpent: 0, emailMessageId: null, emailStatus: null, emailError: null,
      createdBy: null, createdAt: now, updatedAt: now,
    }))
    if (ticket.status === 'resolved' || ticket.status === 'closed') ticket.status = 'open'
    else if (ticket.status === 'waiting_customer') ticket.status = 'in_progress'
    ticket.updatedAt = now
    await tem.flush()
    return { ticketNo: ticket.ticketNo, status: ticket.status }
  })
  if (!outcome) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json({ ok: true, ...outcome }, { status: 201 })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Support',
  summary: 'Portal — reply on your own ticket',
  methods: {
    POST: {
      summary: "Adds the customer's reply and reopens a ticket that had been resolved or closed",
      tags: ['Orva Support'],
      requestBody: { schema: portalReplySchema },
      responses: [{ status: 201, description: 'The reply was recorded.', schema: z.object({ ok: z.boolean(), ticketNo: z.string(), status: z.string() }) }],
      errors: [{ status: 404, description: 'Not the customer\'s ticket', schema: z.object({ error: z.string() }) }],
    },
  },
}
