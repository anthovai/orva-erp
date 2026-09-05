import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { TaskLabel } from '../../data/entities'
import { labelCreateSchema, labelDeleteSchema, labelUpdateSchema } from '../../data/validators'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_tasking.view'] },
  POST: { requireAuth: true, requireFeatures: ['orva_tasking.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['orva_tasking.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['orva_tasking.manage'] },
}

const labelSchema = z.object({
  id: z.string(),
  title: z.string(),
  hexColor: z.string(),
  usageCount: z.number(),
  updatedAt: z.string(),
})

type Row = { id: string; title: string; hex_color: string; usage_count: number; updated_at: string }

/** The duplicate-title index, reported as a conflict rather than a 500. */
const isDuplicateTitle = (message: string) => /orva_tasking_labels_title_unique/.test(message)

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const items = await withTenantRls(em, auth.tenantId, async (tem) => {
    // Usage counted in the same query — a label list whose counts arrive one
    // request at a time is the mistake this module was rewritten to avoid.
    const rows = (await tem.execute(
      `select l.id::text, l.title, l.hex_color, l.updated_at::text,
              count(tl.id)::int as usage_count
       from orva_tasking_labels l
       left join orva_tasking_task_labels tl on tl.label_id = l.id
       where l.deleted_at is null and l.tenant_id = ?::uuid and l.organization_id = ?::uuid
       group by l.id
       order by lower(l.title)`,
      [auth.tenantId, organizationId],
    )) as Row[]
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      hexColor: row.hex_color,
      usageCount: row.usage_count,
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
  const parsed = labelCreateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const created = await withTenantRls(em, auth.tenantId, async (tem) => {
      const now = new Date()
      const label = tem.create(TaskLabel, {
        tenantId: auth.tenantId!, organizationId,
        title: parsed.data.title,
        hexColor: parsed.data.hexColor,
        createdBy: auth.sub ?? null,
        createdAt: now, updatedAt: now,
      })
      tem.persist(label)
      await tem.flush()
      return { id: label.id }
    })
    return Response.json({ ok: true, ...created })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not create the label'
    const duplicate = isDuplicateTitle(message)
    return Response.json(
      { error: duplicate ? 'มีป้ายชื่อนี้อยู่แล้ว' : message },
      { status: duplicate ? 409 : 500 },
    )
  }
}

export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = labelUpdateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })
  const input = parsed.data
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const saved = await withTenantRls(em, auth.tenantId, async (tem) => {
      const label = await tem.findOne(TaskLabel, { id: input.id, tenantId: auth.tenantId!, organizationId, deletedAt: null })
      if (!label) throw Object.assign(new Error('Label not found'), { status: 404 })
      if (label.updatedAt.toISOString() !== new Date(input.updatedAt).toISOString()) {
        throw Object.assign(new Error('Conflict — reload and retry'), { status: 409 })
      }
      if (input.title !== undefined) label.title = input.title
      if (input.hexColor !== undefined) label.hexColor = input.hexColor
      label.updatedAt = new Date()
      await tem.flush()
      return { id: label.id, updatedAt: label.updatedAt.toISOString() }
    })
    return Response.json({ ok: true, ...saved })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Update failed'
    if (isDuplicateTitle(message)) return Response.json({ error: 'มีป้ายชื่อนี้อยู่แล้ว' }, { status: 409 })
    return Response.json({ error: message }, { status: (error as { status?: number }).status ?? 500 })
  }
}

export async function DELETE(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = labelDeleteSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    await withTenantRls(em, auth.tenantId, async (tem) => {
      const label = await tem.findOne(TaskLabel, { id: parsed.data.id, tenantId: auth.tenantId!, organizationId, deletedAt: null })
      if (!label) throw Object.assign(new Error('Label not found'), { status: 404 })
      // The junction rows go with it — a label nobody can see should not keep
      // occupying a task's label list. The tasks themselves are untouched.
      await tem.execute('delete from orva_tasking_task_labels where label_id = ?::uuid', [label.id])
      label.deletedAt = new Date()
      label.updatedAt = new Date()
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
  summary: 'Labels',
  methods: {
    GET: { summary: 'Labels with how many tasks carry each', tags: ['Orva Tasking'], responses: [{ status: 200, description: 'Labels.', schema: z.object({ items: z.array(labelSchema) }) }] },
    POST: { summary: 'Create a label', tags: ['Orva Tasking'], requestBody: { schema: labelCreateSchema }, responses: [{ status: 200, description: 'Created.', schema: z.object({ ok: z.boolean(), id: z.string() }) }], errors: [{ status: 409, description: 'A label with that title exists', schema: z.object({ error: z.string() }) }] },
    PUT: { summary: 'Rename or recolour a label', tags: ['Orva Tasking'], requestBody: { schema: labelUpdateSchema }, responses: [{ status: 200, description: 'Saved.', schema: z.object({ ok: z.boolean(), id: z.string(), updatedAt: z.string() }) }], errors: [{ status: 409, description: 'Stale version or duplicate title', schema: z.object({ error: z.string() }) }] },
    DELETE: { summary: 'Delete a label and remove it from every task', tags: ['Orva Tasking'], requestBody: { schema: labelDeleteSchema }, responses: [{ status: 200, description: 'Deleted.', schema: z.object({ ok: z.boolean() }) }] },
  },
}
