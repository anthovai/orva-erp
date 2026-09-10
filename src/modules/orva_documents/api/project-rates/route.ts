import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { ProjectRate } from '../../data/entities'
import { projectRateSchema } from '../../data/validators'
import { findQuoteById } from '../../lib/source'

export const metadata = {
  PUT: { requireAuth: true, requireFeatures: ['orva_documents.manage'] },
}

/**
 * Sets or clears one project's hourly rate. The default lives on the document
 * settings; a row here is only the exception. Idempotent: one row per quote.
 */
export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = projectRateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const { quoteId, hourlyRate } = parsed.data
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const tenantId = auth.tenantId

  const quote = await findQuoteById(em.fork(), { quoteId, tenantId })
  if (!quote) return Response.json({ error: 'Quote not found' }, { status: 404 })

  const saved = await withTenantRls(em, tenantId, async (tem) => {
    const existing = await tem.findOne(ProjectRate, { tenantId, quoteId })
    if (hourlyRate == null) {
      if (existing) tem.remove(existing)
      await tem.flush()
      return null
    }
    const row = existing ?? tem.create(ProjectRate, { tenantId, organizationId, quoteId, hourlyRate: hourlyRate.toFixed(2), createdAt: new Date(), updatedAt: new Date() })
    row.hourlyRate = hourlyRate.toFixed(2)
    row.updatedAt = new Date()
    if (!existing) tem.persist(row)
    await tem.flush()
    return Number(row.hourlyRate)
  })
  return Response.json({ ok: true, quoteId, hourlyRate: saved })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Documents',
  summary: 'Project hourly rate',
  methods: {
    PUT: {
      summary: "Set one project's hourly rate, or clear it (null) so the company default applies",
      tags: ['Orva Documents'],
      requestBody: { schema: projectRateSchema },
      responses: [{ status: 200, description: 'Saved.', schema: z.object({ ok: z.boolean(), quoteId: z.string(), hourlyRate: z.number().nullable() }) }],
      errors: [{ status: 404, description: 'Quote not found', schema: z.object({ error: z.string() }) }],
    },
  },
}
