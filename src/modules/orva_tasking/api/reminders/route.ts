import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { Task, TaskReminder } from '../../data/entities'
import { reminderCreateSchema, reminderDeleteSchema, reminderListSchema } from '../../data/validators'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_tasking.view'] },
  POST: { requireAuth: true, requireFeatures: ['orva_tasking.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['orva_tasking.manage'] },
}

const reminderSchema = z.object({
  id: z.string(),
  remindAt: z.string().nullable(),
  relativeTo: z.string().nullable(),
  relativeMinutes: z.number().nullable(),
  lastFiredAt: z.string().nullable(),
})

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = reminderListSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const items = await withTenantRls(em, auth.tenantId, async (tem) => {
    const rows = await tem.find(
      TaskReminder,
      { taskId: parsed.data.taskId, tenantId: auth.tenantId!, organizationId },
      { orderBy: { createdAt: 'asc' } },
    )
    return rows.map((row) => ({
      id: row.id,
      remindAt: row.remindAt ? row.remindAt.toISOString() : null,
      relativeTo: row.relativeTo ?? null,
      relativeMinutes: row.relativeMinutes ?? null,
      lastFiredAt: row.lastFiredAt ? row.lastFiredAt.toISOString() : null,
    }))
  })
  return Response.json({ items })
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = reminderCreateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' }, { status: 400 })
  const input = parsed.data
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const created = await withTenantRls(em, auth.tenantId, async (tem) => {
      const task = await tem.findOne(Task, {
        id: input.taskId, tenantId: auth.tenantId!, organizationId, deletedAt: null,
      })
      if (!task) throw Object.assign(new Error('Task not found'), { status: 404 })

      // A relative reminder needs the date it measures from, or it would sit
      // in the table for ever pointing at nothing.
      if (input.relativeTo) {
        const anchor =
          input.relativeTo === 'due' ? task.dueOn
          : input.relativeTo === 'start' ? task.startDate
          : task.endDate
        if (!anchor) {
          throw Object.assign(
            new Error('งานนี้ยังไม่มีวันที่ที่จะนับถอยหลังจาก — ใส่วันก่อน'),
            { status: 400 },
          )
        }
      }

      const now = new Date()
      const reminder = tem.create(TaskReminder, {
        tenantId: auth.tenantId!, organizationId,
        taskId: task.id,
        remindAt: input.remindAt ? new Date(input.remindAt) : null,
        relativeTo: input.relativeTo ?? null,
        relativeMinutes: input.relativeMinutes ?? null,
        lastFiredAt: null,
        createdBy: auth.sub ?? null,
        createdAt: now, updatedAt: now,
      })
      tem.persist(reminder)
      await tem.flush()
      return { id: reminder.id }
    })
    return Response.json({ ok: true, ...created })
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json({ error: error instanceof Error ? error.message : 'Could not save the reminder' }, { status })
  }
}

export async function DELETE(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = reminderDeleteSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    await withTenantRls(em, auth.tenantId, async (tem) => {
      const reminder = await tem.findOne(TaskReminder, {
        id: parsed.data.id, tenantId: auth.tenantId!, organizationId,
      })
      if (!reminder) throw Object.assign(new Error('Reminder not found'), { status: 404 })
      // Hard delete: a reminder carries no history worth keeping, and a
      // soft-deleted one would still have to be filtered out of every scan.
      tem.remove(reminder)
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
  summary: 'Task reminders',
  methods: {
    GET: { summary: "A task's reminders", tags: ['Orva Tasking'], query: reminderListSchema, responses: [{ status: 200, description: 'Reminders.', schema: z.object({ items: z.array(reminderSchema) }) }] },
    POST: { summary: 'Add a reminder — an absolute moment, or an offset from one of the task\'s dates', tags: ['Orva Tasking'], requestBody: { schema: reminderCreateSchema }, responses: [{ status: 200, description: 'Created.', schema: z.object({ ok: z.boolean(), id: z.string() }) }], errors: [{ status: 400, description: 'Both kinds given, neither given, or the anchor date is not set', schema: z.object({ error: z.string() }) }] },
    DELETE: { summary: 'Remove a reminder', tags: ['Orva Tasking'], requestBody: { schema: reminderDeleteSchema }, responses: [{ status: 200, description: 'Deleted.', schema: z.object({ ok: z.boolean() }) }] },
  },
}
