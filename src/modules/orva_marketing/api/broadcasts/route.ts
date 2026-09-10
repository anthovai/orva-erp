import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { Broadcast } from '../../data/entities'
import { broadcastCreateSchema, broadcastDeleteSchema, broadcastListQuerySchema, broadcastUpdateSchema } from '../../data/validators'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_marketing.view'] },
  POST: { requireAuth: true, requireFeatures: ['orva_marketing.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['orva_marketing.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['orva_marketing.manage'] },
}

export const broadcastSchema = z.object({
  id: z.string(), subject: z.string(), body: z.string(), status: z.string(),
  audienceCount: z.number(), sentCount: z.number(), failedCount: z.number(),
  sentAt: z.string().nullable(), createdAt: z.string(), updatedAt: z.string(),
})
export type BroadcastJson = z.infer<typeof broadcastSchema>

export const toJson = (row: Broadcast): BroadcastJson => ({
  id: row.id, subject: row.subject, body: row.body, status: row.status,
  audienceCount: row.audienceCount, sentCount: row.sentCount, failedCount: row.failedCount,
  sentAt: row.sentAt ? row.sentAt.toISOString() : null,
  createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
})

async function scoped(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return { error: organizationScopeRequiredResponse() }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  return { auth, em, scope: { tenantId: auth.tenantId, organizationId } }
}

/** Newest first: drafts the owner is still writing sit beside what went out. */
export async function GET(req: Request) {
  const ctx = await scoped(req)
  if ('error' in ctx) return ctx.error
  const parsed = broadcastListQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const rows = await withTenantRls(ctx.em, ctx.scope.tenantId, (tem) => tem.find(
    Broadcast, { ...ctx.scope, deletedAt: null }, { orderBy: { createdAt: 'desc' }, limit: parsed.data.pageSize },
  ))
  return Response.json({ items: rows.map(toJson) })
}

/** A draft. Nothing is sent until `/send`. */
export async function POST(req: Request) {
  const ctx = await scoped(req)
  if ('error' in ctx) return ctx.error
  const parsed = broadcastCreateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const row = await withTenantRls(ctx.em, ctx.scope.tenantId, async (tem) => {
    const created = tem.create(Broadcast, {
      ...ctx.scope, subject: parsed.data.subject, body: parsed.data.body, status: 'draft',
      audienceCount: 0, sentCount: 0, failedCount: 0, sentAt: null, createdBy: ctx.auth.sub ?? null,
      createdAt: new Date(), updatedAt: new Date(),
    })
    tem.persist(created)
    await tem.flush()
    return created
  })
  return Response.json({ ok: true, item: toJson(row) }, { status: 201 })
}

/** Edit a draft. Anything that has started sending is history and stays as sent. */
export async function PUT(req: Request) {
  const ctx = await scoped(req)
  if ('error' in ctx) return ctx.error
  const parsed = broadcastUpdateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const input = parsed.data
  const outcome = await withTenantRls(ctx.em, ctx.scope.tenantId, async (tem) => {
    const row = await tem.findOne(Broadcast, { id: input.id, ...ctx.scope, deletedAt: null })
    if (!row) return { status: 404 as const }
    if (row.updatedAt.toISOString() !== new Date(input.updatedAt).toISOString()) return { status: 409 as const, row }
    if (row.status !== 'draft') return { status: 422 as const }
    if (input.subject !== undefined) row.subject = input.subject
    if (input.body !== undefined) row.body = input.body
    row.updatedAt = new Date()
    await tem.flush()
    return { status: 200 as const, row }
  })
  if (outcome.status === 404) return Response.json({ error: 'Not found' }, { status: 404 })
  if (outcome.status === 409) return Response.json({ error: 'Changed by someone else', item: toJson(outcome.row) }, { status: 409 })
  if (outcome.status === 422) return Response.json({ error: 'Only a draft can be edited' }, { status: 422 })
  return Response.json({ ok: true, item: toJson(outcome.row) })
}

/** Drop a draft. Sent broadcasts are the send log and are never deleted. */
export async function DELETE(req: Request) {
  const ctx = await scoped(req)
  if ('error' in ctx) return ctx.error
  const parsed = broadcastDeleteSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })
  const status = await withTenantRls(ctx.em, ctx.scope.tenantId, async (tem) => {
    const row = await tem.findOne(Broadcast, { id: parsed.data.id, ...ctx.scope, deletedAt: null })
    if (!row) return 404
    if (row.status !== 'draft') return 422
    row.deletedAt = new Date()
    await tem.flush()
    return 200
  })
  if (status === 404) return Response.json({ error: 'Not found' }, { status: 404 })
  if (status === 422) return Response.json({ error: 'Only a draft can be deleted' }, { status: 422 })
  return Response.json({ ok: true })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Marketing',
  summary: 'Broadcasts',
  methods: {
    GET: { summary: 'List broadcasts, newest first', tags: ['Orva Marketing'], query: broadcastListQuerySchema, responses: [{ status: 200, description: 'Rows.', schema: z.object({ items: z.array(broadcastSchema) }) }] },
    POST: { summary: 'Create a draft broadcast', tags: ['Orva Marketing'], requestBody: { schema: broadcastCreateSchema }, responses: [{ status: 201, description: 'Created.', schema: z.object({ ok: z.boolean(), item: broadcastSchema }) }] },
    PUT: { summary: 'Edit a draft (409 when updatedAt is stale)', tags: ['Orva Marketing'], requestBody: { schema: broadcastUpdateSchema }, responses: [{ status: 200, description: 'Saved.', schema: z.object({ ok: z.boolean(), item: broadcastSchema }) }] },
    DELETE: { summary: 'Delete a draft', tags: ['Orva Marketing'], requestBody: { schema: broadcastDeleteSchema }, responses: [{ status: 200, description: 'Deleted.', schema: z.object({ ok: z.boolean() }) }] },
  },
}
