import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { TaskBucket, TaskProject } from '../../../data/entities'
import { bucketDefaultsSchema } from '../../../data/validators'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['orva_tasking.manage'] },
}

/**
 * Give a project a starter board and place the work it already has.
 *
 * Titles arrive from the screen so they are in the language the user is
 * reading — the alternative, seeding them from a migration, would write Thai
 * into every future tenant's database. The last title becomes the done column,
 * which is where the project's finished tasks land.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = bucketDefaultsSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const { projectId, titles } = parsed.data
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const created = await withTenantRls(em, auth.tenantId, async (tem) => {
      const project = await tem.findOne(TaskProject, {
        id: projectId, tenantId: auth.tenantId!, organizationId, deletedAt: null,
      })
      if (!project) throw Object.assign(new Error('Project not found'), { status: 404 })

      // Idempotent: asking twice must not double the board. The button that
      // calls this is only shown on an empty board, but a double-click is not
      // a reason to end up with six columns.
      const existing = await tem.count(TaskBucket, {
        projectId: project.id, tenantId: auth.tenantId!, organizationId, deletedAt: null,
      })
      if (existing > 0) throw Object.assign(new Error('โปรเจกต์นี้มีบอร์ดอยู่แล้ว'), { status: 409 })

      const now = new Date()
      const buckets = titles.map((title, index) => tem.create(TaskBucket, {
        tenantId: auth.tenantId!, organizationId,
        projectId: project.id,
        title,
        position: index,
        wipLimit: 0,
        isDoneBucket: index === titles.length - 1,
        createdBy: auth.sub ?? null,
        createdAt: now, updatedAt: now,
      }))
      for (const bucket of buckets) tem.persist(bucket)
      await tem.flush()

      const first = buckets[0]
      const done = buckets[buckets.length - 1]

      // Existing work is placed, not stranded: finished tasks in the done
      // column, everything else in the first, each column numbered from zero.
      const placed = (await tem.execute(
        `with ordered as (
           select id, done,
                  row_number() over (partition by done order by position, created_at) - 1 as rn
           from orva_tasking_tasks
           where project_id = ?::uuid and deleted_at is null and bucket_id is null
         )
         update orva_tasking_tasks t
         set bucket_id = case when ordered.done then ?::uuid else ?::uuid end,
             position = ordered.rn,
             updated_at = now()
         from ordered where t.id = ordered.id
         returning t.id`,
        [project.id, done.id, first.id],
      )) as { id: string }[]

      return { bucketIds: buckets.map((bucket) => bucket.id), placedCount: placed.length }
    })
    return Response.json({ ok: true, ...created })
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json({ error: error instanceof Error ? error.message : 'Could not create the board' }, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Tasking',
  summary: 'Starter board',
  methods: {
    POST: {
      summary: "Create a project's first columns and place the work it already has",
      tags: ['Orva Tasking'],
      requestBody: { schema: bucketDefaultsSchema },
      responses: [{ status: 200, description: 'Created.', schema: z.object({ ok: z.boolean(), bucketIds: z.array(z.string()), placedCount: z.number() }) }],
      errors: [{ status: 409, description: 'The project already has a board', schema: z.object({ error: z.string() }) }],
    },
  },
}
