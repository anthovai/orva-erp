import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { cleanDate, createTask, listTasks, readTaskingConfig, setTaskDone } from '../../lib/client'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_tasking.view'] },
  POST: { requireAuth: true, requireFeatures: ['orva_tasking.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['orva_tasking.manage'] },
}

const listQuery = z.object({ projectId: z.coerce.number().int().positive() })

const createBody = z.object({
  projectId: z.coerce.number().int().positive(),
  title: z.string().trim().min(1).max(250),
  description: z.string().trim().max(4000).optional().nullable(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  priority: z.coerce.number().int().min(0).max(5).optional(),
})

const doneBody = z.object({
  taskId: z.coerce.number().int().positive(),
  done: z.boolean(),
})

const taskSchema = z.object({
  id: z.number(),
  identifier: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  done: z.boolean(),
  dueDate: z.string().nullable(),
  priority: z.number(),
  percentDone: z.number(),
})

/** Shapes a Tasking task for Orva's screens, normalising Go's zero dates. */
const toJson = (task: Awaited<ReturnType<typeof listTasks>>[number]) => ({
  id: task.id,
  identifier: task.identifier ?? null,
  title: task.title,
  description: task.description ?? null,
  done: task.done,
  dueDate: cleanDate(task.due_date)?.slice(0, 10) ?? null,
  priority: task.priority ?? 0,
  percentDone: task.percent_done ?? 0,
})

const notConfigured = () =>
  Response.json({ error: 'KKG-Tasking is not configured (TASKING_TOKEN)' }, { status: 503 })

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!resolveActiveOrganizationId(auth)) return organizationScopeRequiredResponse()
  const parsed = listQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const config = readTaskingConfig()
  if (!config) return notConfigured()
  try {
    const tasks = await listTasks(config, parsed.data.projectId)
    // Unfinished work first, then the nearest deadline — the order someone
    // opening the screen actually wants to read.
    const items = tasks.map(toJson).sort((a, b) =>
      Number(a.done) - Number(b.done)
      || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999')
      || a.title.localeCompare(b.title),
    )
    return Response.json({ items })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Tasking unreachable' }, { status: 502 })
  }
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!resolveActiveOrganizationId(auth)) return organizationScopeRequiredResponse()
  const parsed = createBody.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const config = readTaskingConfig()
  if (!config) return notConfigured()
  try {
    const created = await createTask(config, parsed.data.projectId, {
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      due_date: parsed.data.dueDate ?? null,
      priority: parsed.data.priority,
    })
    return Response.json({ ok: true, task: toJson(created) })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Could not create the task' }, { status: 502 })
  }
}

/** Ticking a task off is the one edit worth doing without leaving the list. */
export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!resolveActiveOrganizationId(auth)) return organizationScopeRequiredResponse()
  const parsed = doneBody.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })
  const config = readTaskingConfig()
  if (!config) return notConfigured()
  try {
    const task = await setTaskDone(config, parsed.data.taskId, parsed.data.done)
    return Response.json({ ok: true, task: toJson(task) })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Could not update the task' }, { status: 502 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Tasking',
  summary: 'Tasks in a KKG-Tasking project',
  methods: {
    GET: { summary: 'Tasks of one project, unfinished and soonest-due first', tags: ['Orva Tasking'], query: listQuery, responses: [{ status: 200, description: 'Tasks.', schema: z.object({ items: z.array(taskSchema) }) }] },
    POST: { summary: 'Create a task', tags: ['Orva Tasking'], requestBody: { schema: createBody }, responses: [{ status: 200, description: 'Created.', schema: z.object({ ok: z.boolean(), task: taskSchema }) }] },
    PUT: { summary: 'Mark a task done or not done', tags: ['Orva Tasking'], requestBody: { schema: doneBody }, responses: [{ status: 200, description: 'Updated.', schema: z.object({ ok: z.boolean(), task: taskSchema }) }] },
  },
}
