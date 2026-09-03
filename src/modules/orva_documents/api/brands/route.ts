import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { DocumentBrand } from '../../data/entities'
import { brandDeleteSchema, brandUpsertSchema } from '../../data/validators'
import { loadBrands, peekBrandNumber, readActiveBrandCode } from '../../lib/brands'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_documents.view'] },
  POST: { requireAuth: true, requireFeatures: ['orva_documents.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['orva_documents.manage'] },
}

const brandSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  brandColor: z.string().nullable(),
  logoHeader: z.string().nullable(),
  logoFooter: z.string().nullable(),
  logoHeaderQuotation: z.string().nullable(),
  paymentDetails: z.string().nullable(),
  documentTerms: z.string().nullable(),
  quoteNumberFormat: z.string().nullable(),
  invoiceNumberFormat: z.string().nullable(),
  /** next quotation number this brand would issue */
  nextQuoteNumber: z.string().nullable(),
  updatedAt: z.string(),
})

const listSchema = z.object({ items: z.array(brandSchema), activeCode: z.string().nullable() })

const toJson = (b: DocumentBrand, nextQuoteNumber: string | null) => ({
  id: b.id,
  code: b.code,
  name: b.name,
  brandColor: b.brandColor ?? null,
  logoHeader: b.logoHeader ?? null,
  logoFooter: b.logoFooter ?? null,
  logoHeaderQuotation: b.logoHeaderQuotation ?? null,
  paymentDetails: b.paymentDetails ?? null,
  documentTerms: b.documentTerms ?? null,
  quoteNumberFormat: b.quoteNumberFormat ?? null,
  invoiceNumberFormat: b.invoiceNumberFormat ?? null,
  nextQuoteNumber,
  updatedAt: b.updatedAt.toISOString(),
})

/** Brand profiles of the active organization, plus the operator's currently active brand. */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const scope = { tenantId: auth.tenantId, organizationId }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const items = await withTenantRls(em, scope.tenantId, async (tem) => {
    const brands = await loadBrands(tem, scope)
    return Promise.all(brands.map(async (b) => toJson(b, (await peekBrandNumber(tem, scope, b, 'quote'))?.number ?? null)))
  })
  return Response.json({ items, activeCode: readActiveBrandCode(req) })
}

/** Create or update a brand (matched by id, else by code). */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = brandUpsertSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const scope = { tenantId: auth.tenantId, organizationId }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const input = parsed.data

  try {
    const saved = await withTenantRls(em, scope.tenantId, async (tem) => {
      const existing = input.id
        ? await tem.findOne(DocumentBrand, { id: input.id, ...scope, deletedAt: null })
        : await tem.findOne(DocumentBrand, { code: input.code, ...scope, deletedAt: null })
      if (input.id && !existing) throw Object.assign(new Error('Brand not found'), { status: 404 })
      const clash = await tem.findOne(DocumentBrand, { code: input.code, ...scope, deletedAt: null })
      if (clash && existing && clash.id !== existing.id) throw Object.assign(new Error(`Code ${input.code} is already used`), { status: 409 })

      const now = new Date()
      const row = existing ?? tem.create(DocumentBrand, { ...scope, code: input.code, name: input.name, createdAt: now, updatedAt: now })
      row.code = input.code
      row.name = input.name
      if (input.brandColor !== undefined) row.brandColor = input.brandColor
      if (input.logoHeader !== undefined) row.logoHeader = input.logoHeader
      if (input.logoFooter !== undefined) row.logoFooter = input.logoFooter
      if (input.logoHeaderQuotation !== undefined) row.logoHeaderQuotation = input.logoHeaderQuotation
      if (input.paymentDetails !== undefined) row.paymentDetails = input.paymentDetails || null
      if (input.documentTerms !== undefined) row.documentTerms = input.documentTerms || null
      if (input.quoteNumberFormat !== undefined) row.quoteNumberFormat = input.quoteNumberFormat || null
      if (input.invoiceNumberFormat !== undefined) row.invoiceNumberFormat = input.invoiceNumberFormat || null
      row.updatedAt = now
      tem.persist(row)
      await tem.flush()
      return toJson(row, (await peekBrandNumber(tem, scope, row, 'quote'))?.number ?? null)
    })
    return Response.json(saved)
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json({ error: error instanceof Error ? error.message : 'Failed' }, { status })
  }
}

/** Soft-delete a brand. Documents already numbered in its series keep printing with default settings. */
export async function DELETE(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = brandDeleteSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const ok = await withTenantRls(em, auth.tenantId, async (tem) => {
    const row = await tem.findOne(DocumentBrand, { id: parsed.data.id, tenantId: auth.tenantId, organizationId, deletedAt: null })
    if (!row) return false
    row.deletedAt = new Date()
    await tem.flush()
    return true
  })
  if (!ok) return Response.json({ error: 'Brand not found' }, { status: 404 })
  return Response.json({ ok: true })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Documents',
  summary: 'Brand profiles',
  methods: {
    GET: { summary: 'List brand profiles with their next quotation number', tags: ['Orva Documents'], responses: [{ status: 200, description: 'Brands.', schema: listSchema }] },
    POST: { summary: 'Create or update a brand profile', tags: ['Orva Documents'], requestBody: { schema: brandUpsertSchema }, responses: [{ status: 200, description: 'Saved brand.', schema: brandSchema }] },
    DELETE: { summary: 'Remove a brand profile', tags: ['Orva Documents'], requestBody: { schema: brandDeleteSchema }, responses: [{ status: 200, description: 'Deleted.', schema: z.object({ ok: z.boolean() }) }] },
  },
}
