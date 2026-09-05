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

const labelChipSchema = z.object({ id: z.string(), title: z.string(), hexColor: z.string() })

const taskSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  done: z.boolean(),
  doneAt: z.string().nullable(),
  dueOn: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  percentDone: z.number(),
  identifier: z.string(),
  daysOverdue: z.number(),
  priority: z.number(),
  labels: z.array(labelChipSchema),
  commentCount: z.number(),
  relationCount: z.number(),
  updatedAt: z.string(),
})

type Row = {
  id: string; project_id: string; title: string; description: string | null
  done: boolean; done_at: string | null; due_on: string | null
  start_date: string | null; end_date: string | null
  percent_done: number; identifier_index: number; project_name: string
  priority: number; comment_count: number; relation_count: number
  labels: { id: string; title: string; hexColor: string }[] | null
  updated_at: string
}

const daysBetween = (from: string, to: string) => {
  const u = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))
  return Math.round((u(to) - u(from)) / 864e5)
}

/**
 * Make the task's labels exactly `labelIds`.
 *
 * Only labels that belong to the same tenant and organization survive the
 * insert's own select, so a caller cannot attach another organization's label
 * by passing its id.
 */
async function syncLabels(
  tem: EntityManager,
  tenantId: string,
  organizationId: string,
  taskId: string,
  labelIds: string[],
): Promise<void> {
  await tem.execute(
    `delete from orva_tasking_task_labels
     where task_id = ?::uuid and (cardinality(?::uuid[]) = 0 or label_id <> all(?::uuid[]))`,
    [taskId, labelIds, labelIds],
  )
  if (!labelIds.length) return
  await tem.execute(
    `insert into orva_tasking_task_labels (tenant_id, organization_id, task_id, label_id, created_at)
     select l.tenant_id, l.organization_id, ?::uuid, l.id, now()
     from orva_tasking_labels l
     where l.id = any(?::uuid[]) and l.deleted_at is null
       and l.tenant_id = ?::uuid and l.organization_id = ?::uuid
     on conflict ("task_id", "label_id") do nothing`,
    [taskId, labelIds, tenantId, organizationId],
  )
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
    // Labels and counts arrive with the tasks. Everything joined here lives in
    // this database, which is what makes one query enough — and none of these
    // columns is encrypted, so raw SQL is safe on all of them.
    const rows = (await tem.execute(
      `select t.id::text, t.project_id::text, t.title, t.description, t.done,
              t.done_at::text, to_char(t.due_on, 'YYYY-MM-DD') as due_on,
              to_char(t.start_date, 'YYYY-MM-DD') as start_date,
              to_char(t.end_date, 'YYYY-MM-DD') as end_date,
              t.percent_done, t.identifier_index, p.name as project_name,
              t.priority, t.updated_at::text,
              (select count(*)::int from orva_tasking_task_comments c
                where c.task_id = t.id and c.deleted_at is null) as comment_count,
              (select count(*)::int from orva_tasking_task_relations r
                where r.task_id = t.id) as relation_count,
              (select coalesce(json_agg(json_build_object(
                        'id', l.id::text, 'title', l.title, 'hexColor', l.hex_color)
                        order by lower(l.title)), '[]'::json)
                 from orva_tasking_task_labels tl
                 join orva_tasking_labels l on l.id = tl.label_id and l.deleted_at is null
                where tl.task_id = t.id) as labels
       from orva_tasking_tasks t
       join orva_tasking_projects p on p.id = t.project_id
       where t.deleted_at is null and t.tenant_id = ?::uuid and t.organization_id = ?::uuid
         and (?::uuid is null or t.project_id = ?::uuid)
         and (?::boolean is true or not t.done)
         and (?::boolean is false or (t.start_date is not null and t.end_date is not null))
       order by t.done,
                -- unfinished work sorted by how soon it is due; undated last
                case when t.done then null else t.due_on end asc nulls last,
                t.priority desc, t.position, t.created_at`,
      [auth.tenantId, organizationId, q.projectId ?? null, q.projectId ?? null, q.bucket === 'all', q.hasDates === true],
    )) as Row[]
    return rows.map((row) => ({
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      description: row.description,
      done: row.done,
      doneAt: row.done_at,
      dueOn: row.due_on,
      startDate: row.start_date,
      endDate: row.end_date,
      percentDone: row.percent_done,
      identifier: `${row.project_name}-${row.identifier_index}`,
      daysOverdue: !row.done && row.due_on ? Math.max(0, daysBetween(row.due_on, today)) : 0,
      priority: row.priority,
      labels: row.labels ?? [],
      commentCount: row.comment_count,
      relationCount: row.relation_count,
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

  const attempt = () => withTenantRls(em, auth.tenantId!, async (tem) => {
      // The task carries its own tenant/org rather than trusting the payload,
      // and the project must belong to the same scope.
      const project = await tem.findOne(TaskProject, {
        id: input.projectId, tenantId: auth.tenantId!, organizationId, deletedAt: null,
      })
      if (!project) throw Object.assign(new Error('Project not found'), { status: 404 })
      // The next number in this project. Two simultaneous creates can pick the
      // same one; the unique index rejects the loser and the caller retries,
      // which is cheaper and safer than a counter column to keep in step.
      const [{ next }] = (await tem.execute(
        'select coalesce(max(identifier_index), 0) + 1 as next from orva_tasking_tasks where project_id = ?::uuid',
        [project.id],
      )) as { next: number }[]
      const now = new Date()
      const task = tem.create(Task, {
        tenantId: auth.tenantId!, organizationId,
        projectId: project.id,
        title: input.title,
        description: input.description ?? null,
        done: false, doneAt: null,
        dueOn: input.dueOn ?? null,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        percentDone: input.percentDone ?? 0,
        identifierIndex: next,
        priority: input.priority ?? 0,
        position: 0,
        assigneeUserId: input.assigneeUserId ?? null,
        createdBy: auth.sub ?? null,
        createdAt: now, updatedAt: now,
      })
      tem.persist(task)
      await tem.flush()
      if (input.labelIds?.length) await syncLabels(tem, auth.tenantId!, organizationId, task.id, input.labelIds)
      return { id: task.id, identifierIndex: next }
  })

  // Two people adding a task to the same project at the same moment can pick
  // the same number. The index refuses the second; re-reading the maximum
  // resolves it. Bounded, because a failure that repeats is not a race.
  for (let tries = 0; tries < 3; tries += 1) {
    try {
      const created = await attempt()
      return Response.json({ ok: true, ...created })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not create the task'
      if (/orva_tasking_tasks_identifier_unique/.test(message) && tries < 2) continue
      const status = (error as { status?: number }).status ?? 500
      return Response.json({ error: message }, { status })
    }
  }
  return Response.json({ error: 'Could not create the task' }, { status: 500 })
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
      if (input.startDate !== undefined) task.startDate = input.startDate
      if (input.endDate !== undefined) task.endDate = input.endDate
      if (input.percentDone !== undefined) task.percentDone = input.percentDone
      if (input.priority !== undefined) task.priority = input.priority
      if (input.assigneeUserId !== undefined) task.assigneeUserId = input.assigneeUserId
      // Only the fields that arrived are touched, so a partial edit from the
      // drawer cannot silently clear a date the form never showed. The dates
      // are re-checked together because one may be arriving while the other
      // is already stored.
      const start = input.startDate !== undefined ? input.startDate : task.startDate
      const end = input.endDate !== undefined ? input.endDate : task.endDate
      if (start && end && start > end) {
        throw Object.assign(new Error('วันเริ่มต้องไม่หลังวันจบ'), { status: 400 })
      }
      if (input.done !== undefined && input.done !== task.done) {
        task.done = input.done
        // Stamped, never derived — reopening clears it so "finished last week"
        // cannot be answered with a date the task no longer deserves.
        task.doneAt = input.done ? new Date() : null
      }
      task.updatedAt = new Date()
      await tem.flush()
      // Absent means "leave them alone"; an empty array means "remove them all".
      if (input.labelIds !== undefined) {
        await syncLabels(tem, auth.tenantId!, organizationId, task.id, input.labelIds)
      }
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
    POST: { summary: 'Add a task to a project', tags: ['Orva Tasking'], requestBody: { schema: taskCreateSchema }, responses: [{ status: 200, description: 'Created.', schema: z.object({ ok: z.boolean(), id: z.string(), identifierIndex: z.number() }) }] },
    PUT: { summary: 'Edit a task or tick it off', tags: ['Orva Tasking'], requestBody: { schema: taskUpdateSchema }, responses: [{ status: 200, description: 'Saved.', schema: z.object({ ok: z.boolean(), id: z.string(), done: z.boolean(), updatedAt: z.string() }) }], errors: [{ status: 409, description: 'Stale version', schema: z.object({ error: z.string() }) }] },
  },
}
