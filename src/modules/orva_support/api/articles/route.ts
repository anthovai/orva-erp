import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { SupportArticle } from '../../data/entities'
import { articleCreateSchema, articleDeleteSchema, articleListQuerySchema, articleUpdateSchema } from '../../data/validators'
import { matchesSearch, slugify, uniqueSlug } from '../../lib/articles'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_support.view'] },
  POST: { requireAuth: true, requireFeatures: ['orva_support.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['orva_support.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['orva_support.manage'] },
}

const articleSchema = z.object({
  id: z.string(), title: z.string(), slug: z.string(), summary: z.string().nullable(), body: z.string(),
  tags: z.array(z.string()), isPublished: z.boolean(), position: z.number(), updatedAt: z.string(),
})

const toJson = (row: SupportArticle) => ({
  id: row.id, title: row.title, slug: row.slug, summary: row.summary ?? null, body: row.body,
  tags: row.tags ?? [], isPublished: row.isPublished, position: row.position, updatedAt: row.updatedAt.toISOString(),
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

/** Every article of this organization, drafts included; ordered as the portal shows them. */
export async function GET(req: Request) {
  const ctx = await scoped(req)
  if ('error' in ctx) return ctx.error
  const parsed = articleListQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const rows = await withTenantRls(ctx.em, ctx.scope.tenantId, (tem) => tem.find(
    SupportArticle,
    {
      ...ctx.scope, deletedAt: null,
      ...(parsed.data.published === 'all' ? {} : { isPublished: parsed.data.published === 'yes' }),
    },
    { orderBy: { position: 'asc', title: 'asc' } },
  ))
  const items = rows.filter((row) => matchesSearch(row, parsed.data.search ?? '')).map(toJson)
  return Response.json({ items, counts: { total: rows.length, published: rows.filter((r) => r.isPublished).length } })
}

/** The slug is derived from the title unless one is given, and never collides. */
async function resolveSlug(tem: EntityManager, scope: { tenantId: string; organizationId: string }, wanted: string, exceptId?: string): Promise<string> {
  const rows = await tem.find(SupportArticle, { ...scope, deletedAt: null }, { fields: ['id', 'slug'] })
  const taken = rows.filter((row) => row.id !== exceptId).map((row) => row.slug)
  return uniqueSlug(wanted, taken)
}

export async function POST(req: Request) {
  const ctx = await scoped(req)
  if ('error' in ctx) return ctx.error
  const parsed = articleCreateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const input = parsed.data
  const row = await withTenantRls(ctx.em, ctx.scope.tenantId, async (tem) => {
    const slug = await resolveSlug(tem, ctx.scope, input.slug ?? slugify(input.title))
    const created = tem.create(SupportArticle, {
      ...ctx.scope, title: input.title, slug, summary: input.summary ?? null, body: input.body,
      tags: input.tags ?? [], isPublished: input.isPublished, position: input.position,
      updatedBy: ctx.auth.sub ?? null, createdAt: new Date(), updatedAt: new Date(),
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
  const parsed = articleUpdateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const input = parsed.data
  const outcome = await withTenantRls(ctx.em, ctx.scope.tenantId, async (tem) => {
    const row = await tem.findOne(SupportArticle, { id: input.id, ...ctx.scope, deletedAt: null })
    if (!row) return { status: 404 as const }
    if (row.updatedAt.toISOString() !== new Date(input.updatedAt).toISOString()) return { status: 409 as const, row }
    if (input.title !== undefined) row.title = input.title
    if (input.slug !== undefined) row.slug = await resolveSlug(tem, ctx.scope, input.slug, row.id)
    if (input.summary !== undefined) row.summary = input.summary
    if (input.body !== undefined) row.body = input.body
    if (input.tags !== undefined) row.tags = input.tags
    if (input.isPublished !== undefined) row.isPublished = input.isPublished
    if (input.position !== undefined) row.position = input.position
    row.updatedBy = ctx.auth.sub ?? null
    row.updatedAt = new Date()
    await tem.flush()
    return { status: 200 as const, row }
  })
  if (outcome.status === 404) return Response.json({ error: 'Not found' }, { status: 404 })
  if (outcome.status === 409) return Response.json({ error: 'Changed by someone else', item: toJson(outcome.row) }, { status: 409 })
  return Response.json({ ok: true, item: toJson(outcome.row) })
}

/** Soft delete: the slug is freed, the text is recoverable. */
export async function DELETE(req: Request) {
  const ctx = await scoped(req)
  if ('error' in ctx) return ctx.error
  const parsed = articleDeleteSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })
  const found = await withTenantRls(ctx.em, ctx.scope.tenantId, async (tem) => {
    const row = await tem.findOne(SupportArticle, { id: parsed.data.id, ...ctx.scope, deletedAt: null })
    if (!row) return false
    row.deletedAt = new Date()
    row.isPublished = false
    await tem.flush()
    return true
  })
  if (!found) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json({ ok: true })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Support',
  summary: 'Knowledge base articles',
  methods: {
    GET: { summary: 'Articles of this organization (drafts included), searchable', tags: ['Orva Support'], query: articleListQuerySchema, responses: [{ status: 200, description: 'Rows.', schema: z.object({ items: z.array(articleSchema), counts: z.object({ total: z.number(), published: z.number() }) }) }] },
    POST: { summary: 'Write an article (slug derived from the title when not given)', tags: ['Orva Support'], requestBody: { schema: articleCreateSchema }, responses: [{ status: 201, description: 'Created.', schema: z.object({ ok: z.boolean(), item: articleSchema }) }] },
    PUT: { summary: 'Edit an article (409 when updatedAt is stale)', tags: ['Orva Support'], requestBody: { schema: articleUpdateSchema }, responses: [{ status: 200, description: 'Saved.', schema: z.object({ ok: z.boolean(), item: articleSchema }) }] },
    DELETE: { summary: 'Soft-delete an article and unpublish it', tags: ['Orva Support'], requestBody: { schema: articleDeleteSchema }, responses: [{ status: 200, description: 'Deleted.', schema: z.object({ ok: z.boolean() }) }] },
  },
}
