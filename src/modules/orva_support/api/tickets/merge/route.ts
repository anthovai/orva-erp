import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { SupportTicket } from '../../../data/entities'
import { ticketMergeSchema } from '../../../data/validators'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['orva_support.manage'] },
}

/**
 * Folds one ticket into another — the case where a client's email about an
 * existing problem arrived without anything that tied it to the thread and
 * opened a second ticket.
 *
 * Everything the duplicate held is kept on the target: its replies move over,
 * its own description is appended as the customer's words (or as a note when
 * it was typed by us), minutes add up, and the mail thread ids and contact
 * follow when the target had none, so the next email finds the merged ticket.
 * The duplicate is closed and soft-deleted; nothing is destroyed.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.sub) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = ticketMergeSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const input = parsed.data
  if (input.sourceId === input.targetId) return Response.json({ error: 'เลือกเรื่องอื่นที่จะรวมเข้าไป' }, { status: 400 })
  const tenantId = auth.tenantId
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const merged = await withTenantRls(em, tenantId, async (tem) => {
      const target = await tem.findOne(SupportTicket, { id: input.targetId, tenantId, organizationId, deletedAt: null })
      const source = await tem.findOne(SupportTicket, { id: input.sourceId, tenantId, organizationId, deletedAt: null })
      if (!target || !source) throw Object.assign(new Error('Ticket not found'), { status: 404 })
      if (target.updatedAt.toISOString() !== new Date(input.updatedAt).toISOString()) {
        throw Object.assign(new Error('Conflict — reload and retry'), { status: 409 })
      }
      const now = new Date()

      await tem.execute(
        `update orva_support_replies set ticket_id = ?::uuid, updated_at = now()
         where ticket_id = ?::uuid and tenant_id = ?::uuid and deleted_at is null`,
        [target.id, source.id, tenantId],
      )
      // The duplicate's own text is the customer speaking when it came by
      // email; when we typed it, it is an internal note.
      const carried = `[รวมจาก ${source.ticketNo}] ${source.subject}${source.description ? `\n\n${source.description}` : ''}`
      await tem.execute(
        `insert into orva_support_replies
           (tenant_id, organization_id, ticket_id, author, body, minutes_spent, created_by, created_at, updated_at)
         values (?::uuid, ?::uuid, ?::uuid, ?, ?, 0, ?::uuid, ?, ?)`,
        [tenantId, organizationId, target.id, source.source === 'email' ? 'customer' : 'note', carried.slice(0, 8000), auth.sub, source.createdAt, now],
      )

      target.minutesSpent += source.minutesSpent
      if (!target.threadId && source.threadId) target.threadId = source.threadId
      if (!target.contactEmail && source.contactEmail) target.contactEmail = source.contactEmail
      if (!target.customerEntityId && source.customerEntityId) {
        target.customerEntityId = source.customerEntityId
        target.customerName = source.customerName ?? target.customerName
      }
      if (!target.quoteId && source.quoteId) target.quoteId = source.quoteId
      if (!target.sourceEmailId && source.sourceEmailId) target.sourceEmailId = source.sourceEmailId
      // A redelivery of the source email must land on the merged ticket, so
      // the unique (tenant, source_email_id) slot moves with it.
      source.sourceEmailId = null
      if (target.status === 'resolved' || target.status === 'closed') target.status = 'open'
      target.updatedAt = now

      source.status = 'closed'
      source.closedAt = now
      source.deletedAt = now
      source.updatedAt = now
      await tem.flush()
      return { targetId: target.id, ticketNo: target.ticketNo, updatedAt: target.updatedAt.toISOString(), mergedTicketNo: source.ticketNo }
    })
    return Response.json({ ok: true, ...merged })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json({ error: error instanceof Error ? error.message : 'Merge failed' }, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Support',
  summary: 'Merge one ticket into another',
  methods: {
    POST: {
      summary: 'Fold a duplicate ticket into the one it belongs to (replies move, text is kept, duplicate closed)',
      tags: ['Orva Support'],
      requestBody: { schema: ticketMergeSchema },
      responses: [{ status: 200, description: 'Merged.', schema: z.object({ ok: z.boolean(), targetId: z.string(), ticketNo: z.string(), updatedAt: z.string(), mergedTicketNo: z.string() }) }],
      errors: [{ status: 409, description: 'Stale target version', schema: z.object({ error: z.string() }) }],
    },
  },
}
