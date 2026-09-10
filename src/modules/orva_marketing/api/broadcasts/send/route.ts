import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { Broadcast, BroadcastRecipient, UnsubscribeToken } from '../../../data/entities'
import { broadcastSendSchema } from '../../../data/validators'
import { loadContacts, pickRecipients, type Recipient } from '../../../lib/audience'
import { callInternal } from '../../../lib/internal'
import { newToken, unsubscribeUrl, withUnsubscribeFooter } from '../../../lib/unsubscribe'
import { broadcastSchema, toJson } from '../route'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['orva_marketing.manage', 'messages.compose', 'messages.email'] },
}

const resultSchema = z.object({
  ok: z.boolean(),
  item: broadcastSchema,
  summary: z.object({ audience: z.number(), sent: z.number(), failed: z.number() }),
})

/**
 * Sends a draft to everyone who consented: the audience is read at this
 * moment (a consent withdrawn a minute ago is honoured), each recipient gets
 * one `messages` email carrying their own unsubscribe link, and every attempt
 * is logged. The messages module keeps its RBAC and its delivery worker; the
 * broadcast only knows which message carried each email.
 *
 * Runs inline — a one-person company has hundreds of contacts, not tens of
 * thousands — and marks the broadcast `sending` first so a second click while
 * it runs is refused rather than doubled.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.sub) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = broadcastSendSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const input = parsed.data
  const scope = { tenantId: auth.tenantId, organizationId }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const org = await em.fork().findOne(Organization, { id: organizationId, deletedAt: null })
  const orgSlug = org?.slug
  if (!orgSlug) return Response.json({ error: 'Organization has no slug; the unsubscribe link needs one' }, { status: 422 })
  const origin = (process.env.APP_URL || new URL(req.url).origin).replace(/\/$/, '')

  // Claim the draft: only a draft with the version the screen saw may go out.
  const claimed = await withTenantRls(em, scope.tenantId, async (tem) => {
    const row = await tem.findOne(Broadcast, { id: input.id, ...scope, deletedAt: null })
    if (!row) return { status: 404 as const }
    if (row.updatedAt.toISOString() !== new Date(input.updatedAt).toISOString()) return { status: 409 as const, row }
    if (row.status !== 'draft') return { status: 422 as const, row }
    const contacts = await loadContacts(tem, scope)
    const { recipients } = pickRecipients(contacts)
    if (!recipients.length) return { status: 412 as const, row }
    row.status = 'sending'
    row.audienceCount = recipients.length
    row.updatedAt = new Date()
    // One durable token per contact; the same link in every email they get.
    const existing = await tem.find(UnsubscribeToken, { tenantId: scope.tenantId, customerEntityId: { $in: recipients.map((r) => r.id) } })
    const tokens = new Map(existing.map((t) => [t.customerEntityId, t.token]))
    for (const recipient of recipients) {
      if (tokens.has(recipient.id)) continue
      const token = newToken()
      tem.persist(tem.create(UnsubscribeToken, { ...scope, customerEntityId: recipient.id, token, usedAt: null, createdAt: new Date() }))
      tokens.set(recipient.id, token)
    }
    const rows = recipients.map((recipient) => tem.create(BroadcastRecipient, {
      ...scope, broadcastId: row.id, customerEntityId: recipient.id, displayName: recipient.displayName, email: recipient.email,
      status: 'pending', messageId: null, error: null, createdAt: new Date(), updatedAt: new Date(),
    }))
    rows.forEach((r) => tem.persist(r))
    await tem.flush()
    return { status: 200 as const, row, recipients, tokens, rowIds: new Map(rows.map((r) => [r.customerEntityId, r.id])) }
  })
  if (claimed.status === 404) return Response.json({ error: 'Not found' }, { status: 404 })
  if (claimed.status === 409) return Response.json({ error: 'Changed by someone else', item: toJson(claimed.row) }, { status: 409 })
  if (claimed.status === 422) return Response.json({ error: 'Only a draft can be sent', item: toJson(claimed.row) }, { status: 422 })
  if (claimed.status === 412) return Response.json({ error: 'No consented contact with an email address', item: toJson(claimed.row) }, { status: 412 })

  const { row, recipients, tokens, rowIds } = claimed
  let sent = 0
  let failed = 0
  const mark = (recipient: Recipient, status: 'sent' | 'failed', messageId: string | null, error: string | null) =>
    withTenantRls(em, scope.tenantId, (tem) => tem.execute(
      `update orva_marketing_broadcast_recipients set status = ?, message_id = ?::uuid, error = ?, updated_at = now() where id = ?::uuid and tenant_id = ?::uuid`,
      [status, messageId, error, rowIds.get(recipient.id) ?? null, scope.tenantId],
    ))

  for (const recipient of recipients) {
    const link = unsubscribeUrl(origin, orgSlug, tokens.get(recipient.id) ?? '')
    try {
      const composed = await callInternal<{ id?: string }>(req, '/api/messages', {
        type: 'default',
        visibility: 'public',
        externalEmail: recipient.email,
        externalName: recipient.displayName || undefined,
        subject: row.subject,
        body: withUnsubscribeFooter(row.body, link),
        bodyFormat: 'markdown',
        sendViaEmail: true,
        sourceEntityType: 'orva_marketing:broadcast',
        sourceEntityId: row.id,
      })
      await mark(recipient, 'sent', composed.id ?? null, null)
      sent += 1
    } catch (error) {
      await mark(recipient, 'failed', null, (error instanceof Error ? error.message : String(error)).slice(0, 1000))
      failed += 1
    }
  }

  const finished = await withTenantRls(em, scope.tenantId, async (tem) => {
    const fresh = await tem.findOneOrFail(Broadcast, { id: row.id, ...scope })
    fresh.sentCount = sent
    fresh.failedCount = failed
    fresh.status = failed === 0 ? 'sent' : sent === 0 ? 'failed' : 'partial'
    fresh.sentAt = new Date()
    fresh.updatedAt = new Date()
    await tem.flush()
    return fresh
  })
  return Response.json({ ok: true, item: toJson(finished), summary: { audience: recipients.length, sent, failed } })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Marketing',
  summary: 'Send a broadcast',
  methods: {
    POST: {
      summary: 'Send a draft to every consented contact with an email — one messages email each, with an unsubscribe link — and log the outcome per recipient',
      tags: ['Orva Marketing'],
      requestBody: { schema: broadcastSendSchema },
      responses: [{ status: 200, description: 'Sent (or partially sent).', schema: resultSchema }],
      errors: [
        { status: 409, description: 'The draft changed since the screen loaded', schema: z.object({ error: z.string() }) },
        { status: 412, description: 'Nobody to send to', schema: z.object({ error: z.string() }) },
        { status: 422, description: 'Not a draft', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
