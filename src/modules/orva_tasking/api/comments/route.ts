import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { Task, TaskComment } from '../../data/entities'
import { commentCreateSchema, commentDeleteSchema, commentListSchema, commentUpdateSchema } from '../../data/validators'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_tasking.view'] },
  POST: { requireAuth: true, requireFeatures: ['orva_tasking.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['orva_tasking.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['orva_tasking.manage'] },
}

/**
 * How long an author may still edit their own comment.
 *
 * Long enough to fix a typo, short enough that nobody can quietly rewrite what
 * a colleague already read and replied to.
 */
export const EDIT_WINDOW_MS = 15 * 60 * 1000

const commentSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  body: z.string(),
  authorUserId: z.string().nullable(),
  authorName: z.string().nullable(),
  isCustomerVisible: z.boolean(),
  isFromCustomer: z.boolean(),
  editedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

type Row = {
  id: string; task_id: string; body: string
  author_user_id: string | null; author_name: string | null
  author_customer_user_id: string | null
  is_customer_visible: boolean; edited_at: string | null
  created_at: string; updated_at: string
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = commentListSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const items = await withTenantRls(em, auth.tenantId, async (tem) => {
    const rows = (await tem.execute(
      `select c.id::text, c.task_id::text, c.body,
              c.author_user_id::text, c.author_customer_user_id::text,
              c.is_customer_visible, c.edited_at::text,
              c.created_at::text, c.updated_at::text
       from orva_tasking_task_comments c
       where c.deleted_at is null and c.tenant_id = ?::uuid and c.organization_id = ?::uuid
         and c.task_id = ?::uuid
       order by c.created_at`,
      [auth.tenantId, organizationId, parsed.data.taskId],
    )) as Row[]

    // Author names are resolved separately and never joined in SQL: `users.name`
    // and `users.email` are encrypted at rest with a per-row IV, so a raw select
    // returns ciphertext that renders straight to the screen. Twice already in
    // this codebase — see .ai/lessons/raw-sql-on-encrypted-columns-leaks-
    // ciphertext.md. One bounded lookup for the distinct authors on the task.
    const authorIds = [...new Set(rows.map((r) => r.author_user_id).filter((id): id is string => Boolean(id)))]
    const names = new Map<string, string>()
    if (authorIds.length) {
      const users = await findWithDecryption(tem, User, { id: { $in: authorIds }, deletedAt: null })
      for (const user of users) names.set(user.id, user.name || user.email)
    }

    return rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      body: row.body,
      authorUserId: row.author_user_id,
      authorName: row.author_user_id ? names.get(row.author_user_id) ?? null : null,
      isCustomerVisible: row.is_customer_visible,
      isFromCustomer: row.author_customer_user_id !== null,
      editedAt: row.edited_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
  })
  return Response.json({ items })
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.sub) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = commentCreateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const input = parsed.data
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const created = await withTenantRls(em, auth.tenantId, async (tem) => {
      // The task must be in scope before a comment can hang off it; otherwise a
      // valid uuid from another organization would create an orphan.
      const task = await tem.findOne(Task, {
        id: input.taskId, tenantId: auth.tenantId!, organizationId, deletedAt: null,
      })
      if (!task) throw Object.assign(new Error('Task not found'), { status: 404 })
      const now = new Date()
      const comment = tem.create(TaskComment, {
        tenantId: auth.tenantId!, organizationId,
        taskId: task.id,
        body: input.body,
        authorUserId: auth.sub!,
        authorCustomerUserId: null,
        isCustomerVisible: input.isCustomerVisible,
        editedAt: null,
        createdAt: now, updatedAt: now,
      })
      tem.persist(comment)
      await tem.flush()
      return { id: comment.id }
    })
    return Response.json({ ok: true, ...created })
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json({ error: error instanceof Error ? error.message : 'Could not save the comment' }, { status })
  }
}

export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = commentUpdateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })
  const input = parsed.data
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const saved = await withTenantRls(em, auth.tenantId, async (tem) => {
      const comment = await tem.findOne(TaskComment, { id: input.id, tenantId: auth.tenantId!, organizationId, deletedAt: null })
      if (!comment) throw Object.assign(new Error('Comment not found'), { status: 404 })
      if (comment.updatedAt.toISOString() !== new Date(input.updatedAt).toISOString()) {
        throw Object.assign(new Error('Conflict — reload and retry'), { status: 409 })
      }
      if (input.body !== undefined) {
        // Only the author, only for a short while. Everyone else can reply.
        if (comment.authorUserId !== auth.sub) {
          throw Object.assign(new Error('แก้ไขได้เฉพาะคอมเมนต์ของตัวเอง'), { status: 403 })
        }
        if (Date.now() - comment.createdAt.getTime() > EDIT_WINDOW_MS) {
          throw Object.assign(new Error('หมดเวลาแก้ไขคอมเมนต์แล้ว — ตอบกลับแทนได้'), { status: 403 })
        }
        comment.body = input.body
        comment.editedAt = new Date()
      }
      // Visibility is not the author's private business: anyone who can manage
      // the work decides what the customer sees, at any time.
      if (input.isCustomerVisible !== undefined) comment.isCustomerVisible = input.isCustomerVisible
      comment.updatedAt = new Date()
      await tem.flush()
      return { id: comment.id, updatedAt: comment.updatedAt.toISOString() }
    })
    return Response.json({ ok: true, ...saved })
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json({ error: error instanceof Error ? error.message : 'Update failed' }, { status })
  }
}

export async function DELETE(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = commentDeleteSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    await withTenantRls(em, auth.tenantId, async (tem) => {
      const comment = await tem.findOne(TaskComment, { id: parsed.data.id, tenantId: auth.tenantId!, organizationId, deletedAt: null })
      if (!comment) throw Object.assign(new Error('Comment not found'), { status: 404 })
      if (comment.authorUserId !== auth.sub) {
        throw Object.assign(new Error('ลบได้เฉพาะคอมเมนต์ของตัวเอง'), { status: 403 })
      }
      comment.deletedAt = new Date()
      comment.updatedAt = new Date()
      await tem.flush()
    })
    return Response.json({ ok: true })
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json({ error: error instanceof Error ? error.message : 'Delete failed' }, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Tasking',
  summary: 'Task comments',
  methods: {
    GET: { summary: 'Comments on a task, oldest first', tags: ['Orva Tasking'], query: commentListSchema, responses: [{ status: 200, description: 'Comments.', schema: z.object({ items: z.array(commentSchema) }) }] },
    POST: { summary: 'Add a comment — internal unless marked visible', tags: ['Orva Tasking'], requestBody: { schema: commentCreateSchema }, responses: [{ status: 200, description: 'Created.', schema: z.object({ ok: z.boolean(), id: z.string() }) }] },
    PUT: { summary: 'Edit your own comment within the edit window, or change what the customer may see', tags: ['Orva Tasking'], requestBody: { schema: commentUpdateSchema }, responses: [{ status: 200, description: 'Saved.', schema: z.object({ ok: z.boolean(), id: z.string(), updatedAt: z.string() }) }], errors: [{ status: 403, description: 'Not the author, or the edit window has closed', schema: z.object({ error: z.string() }) }, { status: 409, description: 'Stale version', schema: z.object({ error: z.string() }) }] },
    DELETE: { summary: 'Delete your own comment', tags: ['Orva Tasking'], requestBody: { schema: commentDeleteSchema }, responses: [{ status: 200, description: 'Deleted.', schema: z.object({ ok: z.boolean() }) }] },
  },
}
