import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { TaskProject } from '../../data/entities'
import { projectCreateSchema, projectUpdateSchema } from '../../data/validators'
import { emitTaskingEvent, type TaskingProjectEvent } from '../../events'
import { donePct } from '../../lib/progress'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_tasking.view'] },
  POST: { requireAuth: true, requireFeatures: ['orva_tasking.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['orva_tasking.manage'] },
}

const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  quoteId: z.string().nullable(),
  quoteNumber: z.string().nullable(),
  isArchived: z.boolean(),
  customerVisible: z.boolean(),
  customerLabel: z.string().nullable(),
  total: z.number(),
  done: z.number(),
  donePct: z.number(),
  overdue: z.number(),
  updatedAt: z.string(),
})

type Row = {
  id: string; name: string; description: string | null
  quote_id: string | null; quote_number: string | null; is_archived: boolean
  customer_visible: boolean; customer_label: string | null
  total: number; done: number; overdue: number; updated_at: string
}

/**
 * Projects with their work counted in the same query.
 *
 * The counts are a join rather than a call per project: tasks live in this
 * database, which is the whole reason this module owns them instead of asking
 * a separate service one project at a time.
 */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const today = new Date().toISOString().slice(0, 10)
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const items = await withTenantRls(em, auth.tenantId, async (tem) => {
    const rows = (await tem.execute(
      `select p.id::text, p.name, p.description, p.quote_id::text, q.quote_number,
              p.is_archived, p.customer_visible, p.customer_label, p.updated_at::text,
              count(t.id)::int as total,
              count(t.id) filter (where t.done)::int as done,
              count(t.id) filter (where not t.done and t.due_on is not null and t.due_on < ?::date)::int as overdue
       from orva_tasking_projects p
       left join orva_tasking_tasks t
         on t.project_id = p.id and t.deleted_at is null
       left join sales_quotes q
         on q.id = p.quote_id and q.deleted_at is null
       where p.deleted_at is null and p.tenant_id = ?::uuid and p.organization_id = ?::uuid
       group by p.id, q.quote_number
       order by p.is_archived, p.position, p.created_at`,
      [today, auth.tenantId, organizationId],
    )) as Row[]
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      quoteId: row.quote_id,
      quoteNumber: row.quote_number,
      isArchived: row.is_archived,
      customerVisible: row.customer_visible,
      customerLabel: row.customer_label,
      total: row.total,
      done: row.done,
      donePct: donePct({ total: row.total, done: row.done }),
      overdue: row.overdue,
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
  const parsed = projectCreateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const created = await withTenantRls(em, auth.tenantId, async (tem) => {
      const now = new Date()
      const project = tem.create(TaskProject, {
        tenantId: auth.tenantId!, organizationId,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        quoteId: parsed.data.quoteId ?? null,
        isArchived: false, position: 0,
        // Never published on creation. Linking a quotation is not consent to
        // show the work to the customer named on it.
        customerVisible: false, customerLabel: null,
        createdBy: auth.sub ?? null,
        createdAt: now, updatedAt: now,
      })
      tem.persist(project)
      await tem.flush()
      return {
        id: project.id,
        event: {
          id: project.id,
          tenantId: project.tenantId,
          organizationId: project.organizationId,
          name: project.name,
          isArchived: project.isArchived,
          quoteId: project.quoteId ?? null,
          updatedAt: project.updatedAt.toISOString(),
        } satisfies TaskingProjectEvent,
      }
    })
    // Post-commit, outside withTenantRls: orva_time mirrors this into a staff
    // timesheet project, and that write must not ride on this transaction.
    await emitTaskingEvent('orva_tasking.project.created', created.event)
    return Response.json({ ok: true, id: created.id })
  } catch (error) {
    // The unique index on (tenant, quote) is what enforces one project per
    // quotation; report it as a conflict rather than a server error.
    const message = error instanceof Error ? error.message : 'Could not create the project'
    const conflict = /orva_tasking_projects_quote_unique/.test(message)
    return Response.json(
      { error: conflict ? 'ใบเสนอราคานี้มีโปรเจกต์อยู่แล้ว' : message },
      { status: conflict ? 409 : 500 },
    )
  }
}

export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = projectUpdateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })
  const input = parsed.data
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const saved = await withTenantRls(em, auth.tenantId, async (tem) => {
      const project = await tem.findOne(TaskProject, { id: input.id, tenantId: auth.tenantId!, organizationId, deletedAt: null })
      if (!project) throw Object.assign(new Error('Project not found'), { status: 404 })
      if (project.updatedAt.toISOString() !== new Date(input.updatedAt).toISOString()) {
        throw Object.assign(new Error('Conflict — reload and retry'), { status: 409 })
      }
      const wasArchived = project.isArchived
      if (input.name !== undefined) project.name = input.name
      if (input.description !== undefined) project.description = input.description
      if (input.quoteId !== undefined) project.quoteId = input.quoteId
      if (input.isArchived !== undefined) project.isArchived = input.isArchived
      project.updatedAt = new Date()
      await tem.flush()
      return {
        id: project.id,
        updatedAt: project.updatedAt.toISOString(),
        // Archiving is its own event because it means something different to
        // a listener: the time project is completed, not renamed.
        justArchived: !wasArchived && project.isArchived,
        event: {
          id: project.id,
          tenantId: project.tenantId,
          organizationId: project.organizationId,
          name: project.name,
          isArchived: project.isArchived,
          quoteId: project.quoteId ?? null,
          updatedAt: project.updatedAt.toISOString(),
        } satisfies TaskingProjectEvent,
      }
    })
    await emitTaskingEvent(
      saved.justArchived ? 'orva_tasking.project.archived' : 'orva_tasking.project.updated',
      saved.event,
    )
    return Response.json({ ok: true, id: saved.id, updatedAt: saved.updatedAt })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Update failed'
    // Relinking hits the same unique index POST does: one project per
    // quotation. Without this the caller got a raw Postgres error at 500 for
    // what is a conflict the UI can explain and recover from.
    if (/orva_tasking_projects_quote_unique/.test(message)) {
      return Response.json({ error: 'ใบเสนอราคานี้มีโปรเจกต์อยู่แล้ว' }, { status: 409 })
    }
    const status = (error as { status?: number }).status ?? 500
    return Response.json({ error: message }, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Tasking',
  summary: 'Work projects',
  methods: {
    GET: { summary: 'Projects with tasks done, total and overdue counted in one query', tags: ['Orva Tasking'], responses: [{ status: 200, description: 'Projects.', schema: z.object({ items: z.array(projectSchema) }) }] },
    POST: { summary: 'Create a project, optionally against a quotation', tags: ['Orva Tasking'], requestBody: { schema: projectCreateSchema }, responses: [{ status: 200, description: 'Created.', schema: z.object({ ok: z.boolean(), id: z.string() }) }], errors: [{ status: 409, description: 'That quotation already has a project', schema: z.object({ error: z.string() }) }] },
    PUT: { summary: 'Rename, relink or archive a project', tags: ['Orva Tasking'], requestBody: { schema: projectUpdateSchema }, responses: [{ status: 200, description: 'Saved.', schema: z.object({ ok: z.boolean(), id: z.string(), updatedAt: z.string() }) }], errors: [{ status: 409, description: 'Stale version, or that quotation already has a project', schema: z.object({ error: z.string() }) }] },
  },
}
