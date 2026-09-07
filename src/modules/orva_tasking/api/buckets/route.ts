import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { TaskBucket, TaskProject } from '../../data/entities'
import {
  bucketCreateSchema,
  bucketDeleteSchema,
  bucketListSchema,
  bucketUpdateSchema,
} from '../../data/validators'
import { wipState } from '../../lib/board'
import { toUuidArray } from '../../lib/sql'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_tasking.view'] },
  POST: { requireAuth: true, requireFeatures: ['orva_tasking.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['orva_tasking.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['orva_tasking.manage'] },
}

const bucketSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  position: z.number(),
  wipLimit: z.number(),
  isDoneBucket: z.boolean(),
  openCount: z.number(),
  overWip: z.boolean(),
  updatedAt: z.string(),
})

type Row = {
  id: string; project_id: string; title: string; position: number
  wip_limit: number; is_done_bucket: boolean; open_count: number; updated_at: string
}

const DONE_CONFLICT = /orva_tasking_buckets_done_unique/

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = bucketListSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const items = await withTenantRls(em, auth.tenantId, async (tem) => {
    // Unfinished cards only, because a WIP limit is about work in progress —
    // a column full of finished cards is not a bottleneck.
    const rows = (await tem.execute(
      `select b.id::text, b.project_id::text, b.title, b.position,
              b.wip_limit, b.is_done_bucket, b.updated_at::text,
              count(t.id) filter (where not t.done)::int as open_count
       from orva_tasking_buckets b
       left join orva_tasking_tasks t on t.bucket_id = b.id and t.deleted_at is null
       where b.deleted_at is null and b.tenant_id = ?::uuid and b.organization_id = ?::uuid
         and b.project_id = ?::uuid
       group by b.id
       order by b.position, b.created_at`,
      [auth.tenantId, organizationId, parsed.data.projectId],
    )) as Row[]
    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      position: row.position,
      wipLimit: row.wip_limit,
      isDoneBucket: row.is_done_bucket,
      openCount: row.open_count,
      overWip: wipState(row.open_count, row.wip_limit).over,
      updatedAt: row.updated_at,
    }))
  })
  return Response.json({ items })
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = bucketCreateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const input = parsed.data
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const created = await withTenantRls(em, auth.tenantId, async (tem) => {
      const project = await tem.findOne(TaskProject, {
        id: input.projectId, tenantId: auth.tenantId!, organizationId, deletedAt: null,
      })
      if (!project) throw Object.assign(new Error('Project not found'), { status: 404 })
      const [{ next }] = (await tem.execute(
        `select coalesce(max(position), -1) + 1 as next from orva_tasking_buckets
         where project_id = ?::uuid and deleted_at is null`,
        [project.id],
      )) as { next: number }[]
      const now = new Date()
      const bucket = tem.create(TaskBucket, {
        tenantId: auth.tenantId!, organizationId,
        projectId: project.id,
        title: input.title,
        position: next,
        wipLimit: input.wipLimit,
        isDoneBucket: input.isDoneBucket,
        createdBy: auth.sub ?? null,
        createdAt: now, updatedAt: now,
      })
      tem.persist(bucket)
      await tem.flush()
      return { id: bucket.id }
    })
    return Response.json({ ok: true, ...created })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not create the column'
    if (DONE_CONFLICT.test(message)) {
      return Response.json({ error: 'โปรเจกต์นี้มีคอลัมน์ "เสร็จ" อยู่แล้ว' }, { status: 409 })
    }
    return Response.json({ error: message }, { status: (error as { status?: number }).status ?? 500 })
  }
}

export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = bucketUpdateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })
  const input = parsed.data
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const saved = await withTenantRls(em, auth.tenantId, async (tem) => {
      const bucket = await tem.findOne(TaskBucket, { id: input.id, tenantId: auth.tenantId!, organizationId, deletedAt: null })
      if (!bucket) throw Object.assign(new Error('Column not found'), { status: 404 })
      if (bucket.updatedAt.toISOString() !== new Date(input.updatedAt).toISOString()) {
        throw Object.assign(new Error('Conflict — reload and retry'), { status: 409 })
      }
      if (input.title !== undefined) bucket.title = input.title
      if (input.wipLimit !== undefined) bucket.wipLimit = input.wipLimit
      if (input.isDoneBucket !== undefined) {
        // Moving the done flag is a swap, not an addition: clearing the old one
        // first keeps the unique index satisfied inside the same transaction.
        if (input.isDoneBucket) {
          await tem.execute(
            `update orva_tasking_buckets set is_done_bucket = false, updated_at = now()
             where project_id = ?::uuid and id <> ?::uuid and is_done_bucket and deleted_at is null`,
            [bucket.projectId, bucket.id],
          )
        }
        bucket.isDoneBucket = input.isDoneBucket
      }
      bucket.updatedAt = new Date()
      await tem.flush()

      if (input.order?.length) {
        // Reordering the whole board in one statement, scoped to this project
        // so a foreign id in the list simply matches nothing.
        await tem.execute(
          `update orva_tasking_buckets b
           set position = o.ord - 1, updated_at = now()
           from unnest(?::uuid[]) with ordinality as o(id, ord)
           where b.id = o.id and b.project_id = ?::uuid and b.deleted_at is null`,
          [toUuidArray(input.order), bucket.projectId],
        )
      }
      return { id: bucket.id, updatedAt: bucket.updatedAt.toISOString() }
    })
    return Response.json({ ok: true, ...saved })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Update failed'
    if (DONE_CONFLICT.test(message)) {
      return Response.json({ error: 'โปรเจกต์นี้มีคอลัมน์ "เสร็จ" อยู่แล้ว' }, { status: 409 })
    }
    return Response.json({ error: message }, { status: (error as { status?: number }).status ?? 500 })
  }
}

export async function DELETE(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = bucketDeleteSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const result = await withTenantRls(em, auth.tenantId, async (tem) => {
      const bucket = await tem.findOne(TaskBucket, { id: parsed.data.id, tenantId: auth.tenantId!, organizationId, deletedAt: null })
      if (!bucket) throw Object.assign(new Error('Column not found'), { status: 404 })
      const survivors = await tem.find(
        TaskBucket,
        { projectId: bucket.projectId, tenantId: auth.tenantId!, organizationId, deletedAt: null },
        { orderBy: { position: 'asc' } },
      )
      const target = survivors.find((candidate) => candidate.id !== bucket.id)
      if (!target) throw Object.assign(new Error('ต้องเหลือคอลัมน์ไว้อย่างน้อยหนึ่งคอลัมน์'), { status: 409 })

      // Cards move, they do not disappear. Deleting a column must never be a
      // way to lose work, so they land at the end of the leftmost survivor.
      const moved = (await tem.execute(
        `with next_pos as (
           select coalesce(max(position), -1) + 1 as base
           from orva_tasking_tasks where bucket_id = ?::uuid and deleted_at is null
         ),
         ordered as (
           select id, row_number() over (order by position, created_at) - 1 as rn
           from orva_tasking_tasks where bucket_id = ?::uuid and deleted_at is null
         )
         update orva_tasking_tasks t
         set bucket_id = ?::uuid, position = (select base from next_pos) + ordered.rn, updated_at = now()
         from ordered where t.id = ordered.id
         returning t.id`,
        [target.id, bucket.id, target.id],
      )) as { id: string }[]

      bucket.deletedAt = new Date()
      bucket.updatedAt = new Date()
      await tem.flush()
      return { movedTo: target.title, movedCount: moved.length }
    })
    return Response.json({ ok: true, ...result })
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json({ error: error instanceof Error ? error.message : 'Delete failed' }, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Tasking',
  summary: 'Board columns',
  methods: {
    GET: { summary: "A project's columns with unfinished card counts and WIP state", tags: ['Orva Tasking'], query: bucketListSchema, responses: [{ status: 200, description: 'Columns.', schema: z.object({ items: z.array(bucketSchema) }) }] },
    POST: { summary: 'Add a column', tags: ['Orva Tasking'], requestBody: { schema: bucketCreateSchema }, responses: [{ status: 200, description: 'Created.', schema: z.object({ ok: z.boolean(), id: z.string() }) }], errors: [{ status: 409, description: 'The project already has a done column', schema: z.object({ error: z.string() }) }] },
    PUT: { summary: 'Rename a column, set its WIP limit, move the done flag, or reorder the board', tags: ['Orva Tasking'], requestBody: { schema: bucketUpdateSchema }, responses: [{ status: 200, description: 'Saved.', schema: z.object({ ok: z.boolean(), id: z.string(), updatedAt: z.string() }) }], errors: [{ status: 409, description: 'Stale version, or a second done column', schema: z.object({ error: z.string() }) }] },
    DELETE: { summary: 'Delete a column and move its cards to the first remaining one', tags: ['Orva Tasking'], requestBody: { schema: bucketDeleteSchema }, responses: [{ status: 200, description: 'Deleted.', schema: z.object({ ok: z.boolean(), movedTo: z.string(), movedCount: z.number() }) }], errors: [{ status: 409, description: 'It is the last column', schema: z.object({ error: z.string() }) }] },
  },
}
