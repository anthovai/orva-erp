import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { TaskProject } from '../../../data/entities'
import { publishSchema } from '../../../data/validators'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['orva_tasking.publish'] },
}

/**
 * Show a project to its customer, or stop showing it.
 *
 * Gated on `orva_tasking.publish`, which is deliberately separate from
 * `orva_tasking.manage`: deciding what a customer sees is a different act from
 * editing the work.
 *
 * A project with no quotation cannot be published, because the quotation is
 * what says which customer may see it. The database enforces that too.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = publishSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })
  const input = parsed.data
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const saved = await withTenantRls(em, auth.tenantId, async (tem) => {
      const project = await tem.findOne(TaskProject, {
        id: input.id, tenantId: auth.tenantId!, organizationId, deletedAt: null,
      })
      if (!project) throw Object.assign(new Error('Project not found'), { status: 404 })
      if (project.updatedAt.toISOString() !== new Date(input.updatedAt).toISOString()) {
        throw Object.assign(new Error('Conflict — reload and retry'), { status: 409 })
      }
      if (input.visible && !project.quoteId) {
        throw Object.assign(
          new Error('โปรเจกต์นี้ยังไม่ได้ผูกใบเสนอราคา — ยังไม่รู้ว่าลูกค้ารายไหนควรเห็น'),
          { status: 400 },
        )
      }

      const now = new Date()
      project.customerVisible = input.visible
      if (input.customerLabel !== undefined) project.customerLabel = input.customerLabel
      // Stamped on the way in and cleared on the way out, so "who showed this,
      // and when" stays answerable and is never left claiming a project is
      // published that is not.
      project.publishedAt = input.visible ? now : null
      project.publishedBy = input.visible ? (auth.sub ?? null) : null
      project.updatedAt = now
      await tem.flush()

      // What the customer will actually be able to read, so the caller can say
      // so rather than leaving the owner to guess.
      const [counts] = (await tem.execute(
        `select count(*) filter (where customer_visible)::int as visible_tasks,
                count(*) filter (where not customer_visible)::int as hidden_tasks
         from orva_tasking_tasks
         where project_id = ?::uuid and deleted_at is null`,
        [project.id],
      )) as { visible_tasks: number; hidden_tasks: number }[]

      return {
        id: project.id,
        customerVisible: project.customerVisible,
        updatedAt: project.updatedAt.toISOString(),
        visibleTasks: counts?.visible_tasks ?? 0,
        hiddenTasks: counts?.hidden_tasks ?? 0,
      }
    })
    return Response.json({ ok: true, ...saved })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not change visibility'
    if (/orva_tasking_projects_publish_check/.test(message)) {
      return Response.json({ error: 'โปรเจกต์นี้ยังไม่ได้ผูกใบเสนอราคา' }, { status: 400 })
    }
    return Response.json({ error: message }, { status: (error as { status?: number }).status ?? 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Tasking',
  summary: 'Publish a project to its customer',
  methods: {
    POST: {
      summary: 'Show or stop showing a project on the customer portal',
      tags: ['Orva Tasking'],
      requestBody: { schema: publishSchema },
      responses: [{
        status: 200,
        description: 'Saved.',
        schema: z.object({
          ok: z.boolean(), id: z.string(), customerVisible: z.boolean(), updatedAt: z.string(),
          visibleTasks: z.number(), hiddenTasks: z.number(),
        }),
      }],
      errors: [
        { status: 400, description: 'The project has no quotation, so there is no customer to scope it to', schema: z.object({ error: z.string() }) },
        { status: 409, description: 'Stale version', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
