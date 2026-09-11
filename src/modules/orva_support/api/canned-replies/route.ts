import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { SupportCannedReply } from '../../data/entities'
import { cannedReplyCreateSchema, cannedReplyDeleteSchema, cannedReplyUpdateSchema } from '../../data/validators'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_support.view'] },
  POST: { requireAuth: true, requireFeatures: ['orva_support.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['orva_support.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['orva_support.manage'] },
}

const replySchema = z.object({ id: z.string(), title: z.string(), body: z.string(), position: z.number(), updatedAt: z.string() })

async function scoped(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return { error: organizationScopeRequiredResponse() }
  const container = await createRequestContainer()
  return { auth, em: container.resolve<EntityManager>('em'), scope: { tenantId: auth.tenantId, organizationId } }
}

const toJson = (row: SupportCannedReply) => ({
  id: String(row.id), title: row.title, body: row.body, position: row.position, updatedAt: row.updatedAt.toISOString(),
})

/** The answers worth keeping, in the order the operator put them. */
export async function GET(req: Request) {
  const ctx = await scoped(req)
  if ('error' in ctx) return ctx.error
  const rows = await withTenantRls(ctx.em, ctx.scope.tenantId, (tem) => tem.find(
    SupportCannedReply, { ...ctx.scope, deletedAt: null }, { orderBy: { position: 'asc', title: 'asc' } },
  ))
  return Response.json({ items: rows.map(toJson) })
}

export async function POST(req: Request) {
  const ctx = await scoped(req)
  if ('error' in ctx) return ctx.error
  const parsed = cannedReplyCreateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const row = await withTenantRls(ctx.em, ctx.scope.tenantId, async (tem) => {
    const now = new Date()
    const created = tem.create(SupportCannedReply, {
      ...ctx.scope, title: parsed.data.title, body: parsed.data.body, position: parsed.data.position ?? 0,
      createdBy: ctx.auth.sub ?? null, createdAt: now, updatedAt: now,
    })
    tem.persist(created)
    await tem.flush()
    return created
  })
  return Response.json({ ok: true, item: toJson(row) }, { status: 201 })
}

export async function PUT(req: Request) {
  const ctx = await scoped(req)
  if ('error' in ctx) return ctx.error
  const parsed = cannedReplyUpdateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const input = parsed.data
  const row = await withTenantRls(ctx.em, ctx.scope.tenantId, async (tem) => {
    const found = await tem.findOne(SupportCannedReply, { id: input.id, ...ctx.scope, deletedAt: null })
    if (!found) return null
    if (input.title !== undefined) found.title = input.title
    if (input.body !== undefined) found.body = input.body
    if (input.position !== undefined) found.position = input.position
    found.updatedAt = new Date()
    await tem.flush()
    return found
  })
  if (!row) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json({ ok: true, item: toJson(row) })
}

export async function DELETE(req: Request) {
  const ctx = await scoped(req)
  if ('error' in ctx) return ctx.error
  const parsed = cannedReplyDeleteSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })
  const ok = await withTenantRls(ctx.em, ctx.scope.tenantId, async (tem) => {
    const found = await tem.findOne(SupportCannedReply, { id: parsed.data.id, ...ctx.scope, deletedAt: null })
    if (!found) return false
    found.deletedAt = new Date()
    await tem.flush()
    return true
  })
  if (!ok) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json({ ok: true })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Support',
  summary: 'Canned replies',
  methods: {
    GET: { summary: 'The saved answers, in display order', tags: ['Orva Support'], responses: [{ status: 200, description: 'Rows.', schema: z.object({ items: z.array(replySchema) }) }] },
    POST: { summary: 'Save an answer for reuse', tags: ['Orva Support'], requestBody: { schema: cannedReplyCreateSchema }, responses: [{ status: 201, description: 'Created.', schema: z.object({ ok: z.boolean(), item: replySchema }) }] },
    PUT: { summary: 'Edit a saved answer', tags: ['Orva Support'], requestBody: { schema: cannedReplyUpdateSchema }, responses: [{ status: 200, description: 'Saved.', schema: z.object({ ok: z.boolean(), item: replySchema }) }] },
    DELETE: { summary: 'Remove a saved answer', tags: ['Orva Support'], requestBody: { schema: cannedReplyDeleteSchema }, responses: [{ status: 200, description: 'Deleted.', schema: z.object({ ok: z.boolean() }) }] },
  },
}
