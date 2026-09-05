import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { Task, TaskRelation } from '../../data/entities'
import { relationCreateSchema, relationDeleteSchema } from '../../data/validators'
import { findSubtaskCycle, inverseKind } from '../../lib/relations'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_tasking.view'] },
  POST: { requireAuth: true, requireFeatures: ['orva_tasking.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['orva_tasking.manage'] },
}

const relationListSchema = z.object({ taskId: z.string().uuid() })

const relationSchema = z.object({
  otherTaskId: z.string(),
  kind: z.string(),
  title: z.string(),
  done: z.boolean(),
  identifier: z.string(),
})

type Row = { other_task_id: string; kind: string; title: string; done: boolean; project_name: string; identifier_index: number }

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = relationListSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const items = await withTenantRls(em, auth.tenantId, async (tem) => {
    // One indexed lookup, no union — which is the whole reason both directions
    // are stored.
    const rows = (await tem.execute(
      `select r.other_task_id::text, r.kind, t.title, t.done, t.identifier_index, p.name as project_name
       from orva_tasking_task_relations r
       join orva_tasking_tasks t on t.id = r.other_task_id and t.deleted_at is null
       join orva_tasking_projects p on p.id = t.project_id
       where r.tenant_id = ?::uuid and r.organization_id = ?::uuid and r.task_id = ?::uuid
       order by r.kind, t.identifier_index`,
      [auth.tenantId, organizationId, parsed.data.taskId],
    )) as Row[]
    return rows.map((row) => ({
      otherTaskId: row.other_task_id,
      kind: row.kind,
      title: row.title,
      done: row.done,
      identifier: `${row.project_name}-${row.identifier_index}`,
    }))
  })
  return Response.json({ items })
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = relationCreateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const input = parsed.data
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    await withTenantRls(em, auth.tenantId, async (tem) => {
      // Both ends must be in scope. Checking only one would let a caller link
      // their task to a uuid they guessed from another organization.
      const both = await tem.find(Task, {
        id: { $in: [input.taskId, input.otherTaskId] },
        tenantId: auth.tenantId!, organizationId, deletedAt: null,
      })
      if (both.length !== 2) throw Object.assign(new Error('Task not found'), { status: 404 })

      if (input.kind === 'subtask') {
        const edges = (await tem.execute(
          `select task_id::text as "from", other_task_id::text as "to"
           from orva_tasking_task_relations
           where tenant_id = ?::uuid and organization_id = ?::uuid and kind = 'subtask'`,
          [auth.tenantId, organizationId],
        )) as { from: string; to: string }[]
        const cycle = findSubtaskCycle(edges, input.taskId, input.otherTaskId)
        if (cycle) {
          throw Object.assign(new Error(`งานย่อยวนกลับมาหาตัวเอง (${cycle.length - 1} ขั้น)`), { status: 409 })
        }
      }

      const now = new Date()
      // The pair is written together: a half-written relation would show on one
      // task and not the other, and nothing would ever repair it.
      tem.persist(tem.create(TaskRelation, {
        tenantId: auth.tenantId!, organizationId,
        taskId: input.taskId, otherTaskId: input.otherTaskId, kind: input.kind,
        createdBy: auth.sub ?? null, createdAt: now,
      }))
      tem.persist(tem.create(TaskRelation, {
        tenantId: auth.tenantId!, organizationId,
        taskId: input.otherTaskId, otherTaskId: input.taskId, kind: inverseKind(input.kind),
        createdBy: auth.sub ?? null, createdAt: now,
      }))
      await tem.flush()
    })
    return Response.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not link the tasks'
    if (/orva_tasking_task_relations_unique/.test(message)) {
      return Response.json({ error: 'เชื่อมงานคู่นี้ไว้แล้ว' }, { status: 409 })
    }
    const status = (error as { status?: number }).status ?? 500
    return Response.json({ error: message }, { status })
  }
}

export async function DELETE(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = relationDeleteSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })
  const { taskId, otherTaskId } = parsed.data
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const removed = await withTenantRls(em, auth.tenantId, async (tem) => {
    // Both rows go, whichever end the user clicked from.
    const result = await tem.execute(
      `delete from orva_tasking_task_relations
       where tenant_id = ?::uuid and organization_id = ?::uuid
         and ((task_id = ?::uuid and other_task_id = ?::uuid)
           or (task_id = ?::uuid and other_task_id = ?::uuid))`,
      [auth.tenantId, organizationId, taskId, otherTaskId, otherTaskId, taskId],
    )
    return result
  })
  void removed
  return Response.json({ ok: true })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Tasking',
  summary: 'Task relations',
  methods: {
    GET: { summary: "One task's links to other tasks", tags: ['Orva Tasking'], query: relationListSchema, responses: [{ status: 200, description: 'Relations.', schema: z.object({ items: z.array(relationSchema) }) }] },
    POST: { summary: 'Link two tasks; the inverse is written automatically', tags: ['Orva Tasking'], requestBody: { schema: relationCreateSchema }, responses: [{ status: 200, description: 'Linked.', schema: z.object({ ok: z.boolean() }) }], errors: [{ status: 409, description: 'Already linked, or the link would create a sub-task cycle', schema: z.object({ error: z.string() }) }] },
    DELETE: { summary: 'Unlink two tasks, from either end', tags: ['Orva Tasking'], requestBody: { schema: relationDeleteSchema }, responses: [{ status: 200, description: 'Unlinked.', schema: z.object({ ok: z.boolean() }) }] },
  },
}
