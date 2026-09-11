import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { Task, TaskProject } from '../../../data/entities'
import { tasksFromQuoteSchema } from '../../../data/validators'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['orva_tasking.manage'] },
}

type QuoteLineRow = { name: string | null; description: string | null; line_number: number }

/**
 * Turn what was quoted into the work to do.
 *
 * A project is normally one quotation, and the lines of that quotation are
 * already the deliverables written in the customer's own words — retyping
 * them as tasks is copying a list from one screen to another. This does the
 * copy once.
 *
 * Two decisions worth stating:
 *
 * - It creates tasks and then lets them go. No link is kept back to the
 *   line, because work does not stay shaped like a quotation: a line becomes
 *   three tasks, a task gets dropped, and a link that has to be maintained
 *   through that would be wrong more often than right. Billing stays what it
 *   already is — % งวด against the whole quote.
 * - Pressing it twice does not duplicate anything. Titles already on the
 *   project are skipped, so it is safe to press again after adding a line —
 *   the answer says how many were added and how many were already there.
 *
 * The quote is read with SQL rather than through the sales module: tasking
 * owns `quoteId` as a bare uuid and reads what it points at, the same seam
 * `orva_documents` uses onto the same tables.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = tasksFromQuoteSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const tenantId = auth.tenantId

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const outcome = await withTenantRls(em, tenantId, async (tem) => {
    const project = await tem.findOne(TaskProject, {
      id: parsed.data.projectId, tenantId, organizationId, deletedAt: null,
    })
    if (!project) return { error: 'ไม่พบโปรเจกต์นี้', status: 404 as const }
    // The quote comes from the project, never from the request: a caller may
    // not name a project and then point it at somebody else's quotation.
    if (!project.quoteId) return { error: 'โปรเจกต์นี้ยังไม่ได้ผูกกับใบเสนอราคา', status: 400 as const }

    const lines = (await tem.execute(
      `select l.name, l.description, l.line_number
       from sales_quote_lines l
       where l.quote_id = ?::uuid and l.tenant_id = ?::uuid and l.organization_id = ?::uuid
         and l.deleted_at is null
       order by l.line_number`,
      [project.quoteId, tenantId, organizationId],
    )) as QuoteLineRow[]
    if (!lines.length) return { error: 'ใบเสนอราคานี้ยังไม่มีรายการ', status: 400 as const }

    const existing = await tem.find(Task, { projectId: project.id, tenantId, deletedAt: null }, { fields: ['title'] })
    const taken = new Set(existing.map((task) => task.title.trim()))
    const [{ next }] = (await tem.execute(
      'select coalesce(max(identifier_index), 0) + 1 as next from orva_tasking_tasks where project_id = ?::uuid',
      [project.id],
    )) as { next: number }[]
    const [{ tail }] = (await tem.execute(
      'select coalesce(max(position), 0) as tail from orva_tasking_tasks where project_id = ?::uuid',
      [project.id],
    )) as { tail: number }[]

    const now = new Date()
    let index = Number(next)
    let position = Number(tail)
    let added = 0
    let skipped = 0
    for (const line of lines) {
      const title = (line.name ?? '').trim()
      if (!title || taken.has(title)) { skipped++; continue }
      taken.add(title)
      position += 1
      tem.persist(tem.create(Task, {
        tenantId, organizationId,
        projectId: project.id,
        title,
        description: line.description?.trim() || null,
        done: false, doneAt: null,
        dueOn: null, startDate: null, endDate: null,
        percentDone: 0,
        identifierIndex: index++,
        customerVisible: true,
        priority: 0,
        position,
        assigneeUserId: null,
        createdBy: auth.sub ?? null,
        createdAt: now, updatedAt: now,
      }))
      added++
    }
    if (added) await tem.flush()
    return { added, skipped, total: lines.length }
  })

  if ('error' in outcome) return Response.json({ error: outcome.error }, { status: outcome.status })
  return Response.json({ ok: true, ...outcome })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Tasking',
  summary: 'Create the project\'s tasks from its quotation lines',
  methods: {
    POST: {
      summary: 'Adds one task per line of the project\'s quotation, skipping titles the project already has',
      tags: ['Orva Tasking'],
      requestBody: { schema: tasksFromQuoteSchema },
      responses: [{
        status: 200,
        description: 'How many tasks were added, and how many lines were already there.',
        schema: z.object({ ok: z.boolean(), added: z.number(), skipped: z.number(), total: z.number() }),
      }],
      errors: [
        { status: 400, description: 'The project has no quotation, or the quotation has no lines', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'No such project in this scope', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
