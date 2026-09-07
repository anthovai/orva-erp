import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { Task, TaskAttachmentFlag } from '../../data/entities'
import { attachmentFlagSchema } from '../../data/validators'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_tasking.view'] },
  PUT: { requireAuth: true, requireFeatures: ['orva_tasking.publish'] },
}

const flagSchema = z.object({ attachmentId: z.string(), isCustomerVisible: z.boolean() })
const listSchema = z.object({ taskId: z.string().uuid() })

/**
 * Which of a task's files the customer may open.
 *
 * The file itself belongs to the installed `attachments` module, which this
 * module must not modify, so visibility lives in a row of its own. Absence of
 * a row means not visible — a file that nobody has decided about stays inside.
 *
 * Gated on `orva_tasking.publish` rather than `manage`, for the same reason
 * publishing a project is: showing something to a customer is its own act.
 */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = listSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const items = await withTenantRls(em, auth.tenantId, async (tem) => {
    const rows = await tem.find(TaskAttachmentFlag, {
      taskId: parsed.data.taskId, tenantId: auth.tenantId!, organizationId,
    })
    return rows.map((row) => ({ attachmentId: row.attachmentId, isCustomerVisible: row.isCustomerVisible }))
  })
  return Response.json({ items })
}

export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = attachmentFlagSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })
  const input = parsed.data
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    await withTenantRls(em, auth.tenantId, async (tem) => {
      // The task must be in scope; the attachment id is only meaningful with
      // it, and one unique flag row exists per attachment.
      const task = await tem.findOne(Task, {
        id: input.taskId, tenantId: auth.tenantId!, organizationId, deletedAt: null,
      })
      if (!task) throw Object.assign(new Error('Task not found'), { status: 404 })

      const existing = await tem.findOne(TaskAttachmentFlag, { attachmentId: input.attachmentId })
      const now = new Date()
      if (existing) {
        if (existing.tenantId !== auth.tenantId || existing.organizationId !== organizationId) {
          throw Object.assign(new Error('Not found'), { status: 404 })
        }
        existing.isCustomerVisible = input.isCustomerVisible
        existing.updatedAt = now
      } else {
        tem.persist(tem.create(TaskAttachmentFlag, {
          tenantId: auth.tenantId!, organizationId,
          taskId: task.id,
          attachmentId: input.attachmentId,
          isCustomerVisible: input.isCustomerVisible,
          createdAt: now, updatedAt: now,
        }))
      }
      await tem.flush()
    })
    return Response.json({ ok: true })
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json({ error: error instanceof Error ? error.message : 'Update failed' }, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Tasking',
  summary: 'File visibility',
  methods: {
    GET: { summary: "Which of a task's files the customer may open", tags: ['Orva Tasking'], query: listSchema, responses: [{ status: 200, description: 'Flags.', schema: z.object({ items: z.array(flagSchema) }) }] },
    PUT: { summary: 'Show or hide one file from the customer', tags: ['Orva Tasking'], requestBody: { schema: attachmentFlagSchema }, responses: [{ status: 200, description: 'Saved.', schema: z.object({ ok: z.boolean() }) }] },
  },
}
