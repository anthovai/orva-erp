import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { TaskComment } from '../../../data/entities'
import { portalCommentSchema } from '../../../data/validators'
import { isResponse, resolvePortalScope } from '../../../lib/portalScope'

export const metadata = {
  POST: { requireAuth: false },
}

/**
 * A customer replies on a task.
 *
 * Written as the customer, always visible (they wrote it, so hiding it from
 * them would be absurd), and only ever against a task inside a project they
 * can already see — the same three scope conditions as the read routes,
 * checked here rather than trusted from the payload.
 *
 * `isCustomerVisible` is not in the schema on purpose: a customer cannot mark
 * their own comment internal, which would be a way to write into the team's
 * private notes.
 */
export async function POST(req: Request) {
  const scope = await resolvePortalScope(req)
  if (isResponse(scope)) return scope
  if (!scope.auth.resolvedFeatures?.includes('orva_tasking.portal.comment')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = portalCommentSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })
  const input = parsed.data

  try {
    const created = await withTenantRls(scope.em, scope.tenantId, async (tem) => {
      const [task] = (await tem.execute(
        `select t.id::text
         from orva_tasking_tasks t
         join orva_tasking_projects p on p.id = t.project_id and p.deleted_at is null
         join sales_quotes q
           on q.id = p.quote_id and q.deleted_at is null
          and q.tenant_id = p.tenant_id
          and q.customer_entity_id = ?::uuid
         where t.id = ?::uuid and t.deleted_at is null and t.customer_visible
           and t.tenant_id = ?::uuid and t.organization_id = ?::uuid
           and p.customer_visible`,
        [scope.customerEntityId, input.taskId, scope.tenantId, scope.organizationId],
      )) as { id: string }[]
      // 404 rather than 403: a customer must not be able to discover which
      // task ids exist by watching the status code change.
      if (!task) throw Object.assign(new Error('Not found'), { status: 404 })

      const now = new Date()
      const comment = tem.create(TaskComment, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        taskId: task.id,
        body: input.body,
        authorUserId: null,
        authorCustomerUserId: scope.auth.sub,
        isCustomerVisible: true,
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
    return Response.json(
      { error: status === 404 ? 'Not found' : 'ส่งคอมเมนต์ไม่สำเร็จ' },
      { status },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Tasking',
  summary: 'Portal: comment',
  methods: {
    POST: {
      summary: 'Add a comment to a task the customer can see',
      tags: ['Orva Tasking'],
      requestBody: { schema: portalCommentSchema },
      responses: [{ status: 200, description: 'Created.', schema: z.object({ ok: z.boolean(), id: z.string() }) }],
      errors: [
        { status: 403, description: 'The account may read but not comment', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'No such task for this customer', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
