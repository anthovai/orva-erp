import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { Task, TaskProject } from '../../data/entities'
import { taskCreateSchema, taskListSchema, taskUpdateSchema } from '../../data/validators'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_tasking.view'] },
  POST: { requireAuth: true, requireFeatures: ['orva_tasking.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['orva_tasking.manage'] },
}

const taskSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  done: z.boolean(),
  doneAt: z.string().nullable(),
  dueOn: z.string().nullable(),
  daysOverdue: z.number(),
  priority: z.number(),
  updatedAt: z.string(),
})

type Row = {
  id: string; project_id: string; title: string; description: string | null
  done: boolean; done_at: string | null; due_on: string | null
  priority: number; updated_at: string
}

const daysBetween = (from: string, to: string) => {
  const u = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
  return Math.round((u(to) - u(from)) / 864e5)
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = taskListSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const q = parsed.data
  const today = new Date().toISOString().slice(0, 10)
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const items = await withTenantRls(em, auth.tenantId, async (tem) => {
    const rows = (await tem.execute(
      `select t.id::text, t.project_id::text, t.title, t.description, t.done,
              t.done_at::text, to_char(t.due_on, 'YYYY-MM-DD') as due_on,
              t.priority, t.updated_at::text
       from orva_tasking_tasks t
       where t.deleted_at is null and t.tenant_id = ?::uuid and t.organization_id = ?::uuid
         and (?::uuid is null or t.project_id = ?::uuid)
         and (?::boolean is true or not t.done)
       order by t.done,
                -- unfinished work sorted by how soon it is due; undated last
                case when t.done then null else t.due_on end asc nulls last,
                t.priority desc, t.position, t.created_at`,
      [auth.tenantId, organizationId, q.projectId ?? null, q.projectId ?? null, q.bucket === 'all'],
    )) as Row[]
    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      description: row.description,
      done: row.done,
      doneAt: row.done_at,
      dueOn: row.due_on,
      daysOverdue: !row.done && row.due_on ? Math.max(0, daysBetween(row.due_on, today)) : 0,
      priority: row.priority,
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
  const parsed = taskCreateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const input = parsed.data
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const created = await withTenantRls(em, auth.tenantId, async (tem) => {
      // The task carries its own tenant/org rather than trusting the payload,
      // and the project must belong to the same scope.
      const project = await tem.findOne(TaskProject, {
        id: input.projectId, tenantId: auth.tenantId!, organizationId, deletedAt: null,
      })
      if (!project) throw Object.assign(new Error('Project not found'), { status: 404 })
      const now = new Date()
      const task = tem.create(Task, {
        tenantId: auth.tenantId!, organizationId,
        projectId: project.id,
        title: input.title,
        description: input.description ?? null,
        done: false, doneAt: null,
        dueOn: input.dueOn ?? null,
        priority: input.priority ?? 0,
        position: 0,
        assigneeUserId: input.assigneeUserId ?? null,
        createdBy: auth.sub ?? null,
        createdAt: now, updatedAt: now,
      })
      tem.persist(task)
      await tem.flush()
      return { id: task.id }
    })
    return Response.json({ ok: true, ...created })
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json({ error: error instanceof Error ? error.message : 'Could not create the task' }, { status })
  }
}

export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = taskUpdateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })
  const input = parsed.data
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const saved = await withTenantRls(em, auth.tenantId, async (tem) => {
      const task = await tem.findOne(Task, { id: input.id, tenantId: auth.tenantId!, organizationId, deletedAt: null })
      if (!task) throw Object.assign(new Error('Task not found'), { status: 404 })
      if (task.updatedAt.toISOString() !== new Date(input.updatedAt).toISOString()) {
        throw Object.assign(new Error('Conflict — reload and retry'), { status: 409 })
      }
      if (input.title !== undefined) task.title = input.title
      if (input.description !== undefined) task.description = input.description
      if (input.dueOn !== undefined) task.dueOn = input.dueOn
      if (input.priority !== undefined) task.priority = input.priority
      if (input.assigneeUserId !== undefined) task.assigneeUserId = input.assigneeUserId
      if (input.done !== undefined && input.done !== task.done) {
        task.done = input.done
        // Stamped, never derived — reopening clears it so "finished last week"
        // cannot be answered with a date the task no longer deserves.
        task.doneAt = input.done ? new Date() : null
      }
      task.updatedAt = new Date()
      await tem.flush()
      return { id: task.id, done: task.done, updatedAt: task.updatedAt.toISOString() }
    })
    return Response.json({ ok: true, ...saved })
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json({ error: error instanceof Error ? error.message : 'Update failed' }, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Tasking',
  summary: 'Tasks',
  methods: {
    GET: { summary: 'Tasks, unfinished and soonest-due first', tags: ['Orva Tasking'], query: taskListSchema, responses: [{ status: 200, description: 'Tasks.', schema: z.object({ items: z.array(taskSchema) }) }] },
    POST: { summary: 'Add a task to a project', tags: ['Orva Tasking'], requestBody: { schema: taskCreateSchema }, responses: [{ status: 200, description: 'Created.', schema: z.object({ ok: z.boolean(), id: z.string() }) }] },
    PUT: { summary: 'Edit a task or tick it off', tags: ['Orva Tasking'], requestBody: { schema: taskUpdateSchema }, responses: [{ status: 200, description: 'Saved.', schema: z.object({ ok: z.boolean(), id: z.string(), done: z.boolean(), updatedAt: z.string() }) }], errors: [{ status: 409, description: 'Stale version', schema: z.object({ error: z.string() }) }] },
  },
}
