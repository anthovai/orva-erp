import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { Task, TaskBucket } from '../../../data/entities'
import { taskMoveSchema } from '../../../data/validators'
import { placeCard, wipState } from '../../../lib/board'
import { toUuidArray } from '../../../lib/sql'

export const metadata = {
  PUT: { requireAuth: true, requireFeatures: ['orva_tasking.manage'] },
}

/**
 * Move a card to a column and a place within it.
 *
 * The same route serves the mouse and the keyboard, so the two can never drift
 * apart. Dropping into the done column ticks the task done and stamps
 * `doneAt`; taking it out reopens it and clears the stamp — the board and the
 * checkbox are two views of one field, not two fields.
 */
export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = taskMoveSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })
  const input = parsed.data
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const result = await withTenantRls(em, auth.tenantId, async (tem) => {
      const task = await tem.findOne(Task, {
        id: input.id, tenantId: auth.tenantId!, organizationId, deletedAt: null,
      })
      if (!task) throw Object.assign(new Error('Task not found'), { status: 404 })
      // Someone else moved this card while it was on screen. Say so rather
      // than overwriting their move.
      if (task.updatedAt.toISOString() !== new Date(input.updatedAt).toISOString()) {
        throw Object.assign(new Error('มีคนย้ายการ์ดนี้ไปแล้ว — โหลดบอร์ดใหม่'), { status: 409 })
      }

      const bucket = await tem.findOne(TaskBucket, {
        id: input.bucketId, tenantId: auth.tenantId!, organizationId, deletedAt: null,
      })
      if (!bucket) throw Object.assign(new Error('Column not found'), { status: 404 })
      // A card cannot cross into another project's board.
      if (bucket.projectId !== task.projectId) {
        throw Object.assign(new Error('Column not found'), { status: 404 })
      }

      const now = new Date()
      const wasInBucket = task.bucketId
      task.bucketId = bucket.id

      if (bucket.isDoneBucket && !task.done) {
        task.done = true
        task.doneAt = now
      } else if (!bucket.isDoneBucket && task.done && wasInBucket !== bucket.id) {
        task.done = false
        task.doneAt = null
      }
      task.updatedAt = now
      await tem.flush()

      // The destination column as it stands now, then renumbered from zero
      // with the card at its new index. Integers, not fractions: renumbering
      // one column is one statement, and the order is exactly what was shown.
      const existing = (await tem.execute(
        `select id::text from orva_tasking_tasks
         where bucket_id = ?::uuid and deleted_at is null
         order by position, created_at`,
        [bucket.id],
      )) as { id: string }[]
      const ordered = placeCard(existing.map((row) => row.id), task.id, input.index)
      await tem.execute(
        `update orva_tasking_tasks t
         set position = o.ord - 1
         from unnest(?::uuid[]) with ordinality as o(id, ord)
         where t.id = o.id and t.bucket_id = ?::uuid`,
        [toUuidArray(ordered), bucket.id],
      )

      const [{ open_count }] = (await tem.execute(
        `select count(*)::int as open_count from orva_tasking_tasks
         where bucket_id = ?::uuid and deleted_at is null and not done`,
        [bucket.id],
      )) as { open_count: number }[]

      return {
        id: task.id,
        done: task.done,
        updatedAt: task.updatedAt.toISOString(),
        // Reported so the column can warn; the move already succeeded.
        wip: wipState(open_count, bucket.wipLimit),
      }
    })
    return Response.json({ ok: true, ...result })
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json({ error: error instanceof Error ? error.message : 'Move failed' }, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Tasking',
  summary: 'Move a card',
  methods: {
    PUT: {
      summary: 'Move a task to a column and a place within it; the done column ticks it done',
      tags: ['Orva Tasking'],
      requestBody: { schema: taskMoveSchema },
      responses: [{
        status: 200,
        description: 'Moved.',
        schema: z.object({
          ok: z.boolean(), id: z.string(), done: z.boolean(), updatedAt: z.string(),
          wip: z.object({ over: z.boolean(), count: z.number(), limit: z.number() }),
        }),
      }],
      errors: [{ status: 409, description: 'Someone else moved the card first', schema: z.object({ error: z.string() }) }],
    },
  },
}
