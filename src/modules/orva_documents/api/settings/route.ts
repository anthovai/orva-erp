import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import {
  resolveActiveOrganizationId,
  organizationScopeRequiredResponse,
} from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { DocumentSettings } from '../../data/entities'
import { settingsPutSchema } from '../../data/validators'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_documents.view'] },
  PUT: { requireAuth: true, requireFeatures: ['orva_documents.manage'] },
}

const settingsSchema = z.object({
  sellerName: z.string(),
  sellerLegalName: z.string().nullable(),
  sellerTaxId: z.string().nullable(),
  sellerBranch: z.string().nullable(),
  sellerAddress: z.string().nullable(),
  sellerPhone: z.string().nullable(),
  sellerEmail: z.string().nullable(),
  templateQuotation: z.string(),
  templateInvoice: z.string(),
  templateTaxInvoice: z.string(),
  templateReceipt: z.string(),
  invoiceNumberFormat: z.string(),
  updatedAt: z.string().nullable(),
})

function serialize(row: DocumentSettings | null) {
  if (!row) {
    return {
      sellerName: '',
      sellerLegalName: null,
      sellerTaxId: null,
      sellerBranch: 'สำนักงานใหญ่',
      sellerAddress: null,
      sellerPhone: null,
      sellerEmail: null,
      templateQuotation: 'classic',
      templateInvoice: 'classic',
      templateTaxInvoice: 'classic',
      templateReceipt: 'classic',
      invoiceNumberFormat: 'INV-{yyyy}{mm}{dd}-{seq:5}',
      updatedAt: null,
    }
  }
  return {
    sellerName: row.sellerName,
    sellerLegalName: row.sellerLegalName ?? null,
    sellerTaxId: row.sellerTaxId ?? null,
    sellerBranch: row.sellerBranch ?? null,
    sellerAddress: row.sellerAddress ?? null,
    sellerPhone: row.sellerPhone ?? null,
    sellerEmail: row.sellerEmail ?? null,
    templateQuotation: row.templateQuotation,
    templateInvoice: row.templateInvoice,
    templateTaxInvoice: row.templateTaxInvoice,
    templateReceipt: row.templateReceipt,
    invoiceNumberFormat: row.invoiceNumberFormat,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  }
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const row = await withTenantRls(em, auth.tenantId, async (tem) =>
    tem.findOne(DocumentSettings, { tenantId: auth.tenantId!, organizationId, deletedAt: null }),
  )
  return Response.json(serialize(row))
}

export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = settingsPutSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) {
    return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  }
  const input = parsed.data
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const row = await withTenantRls(em, auth.tenantId, async (tem) => {
    const existing = await tem.findOne(DocumentSettings, {
      tenantId: auth.tenantId!,
      organizationId,
      deletedAt: null,
    })
    const target =
      existing ??
      tem.create(DocumentSettings, {
        tenantId: auth.tenantId!,
        organizationId,
        sellerName: input.sellerName,
        invoiceNumberFormat: 'INV-{yyyy}{mm}{dd}-{seq:5}',
        templateQuotation: 'classic',
        templateInvoice: 'classic',
        templateTaxInvoice: 'classic',
        templateReceipt: 'classic',
        createdAt: new Date(),
      })
    target.sellerName = input.sellerName
    target.sellerLegalName = input.sellerLegalName ?? null
    target.sellerTaxId = input.sellerTaxId ? input.sellerTaxId.replace(/[\s-]/g, '') : null
    target.sellerBranch = input.sellerBranch ?? null
    target.sellerAddress = input.sellerAddress ?? null
    target.sellerPhone = input.sellerPhone ?? null
    target.sellerEmail = input.sellerEmail ?? null
    if (input.invoiceNumberFormat) target.invoiceNumberFormat = input.invoiceNumberFormat
    if (input.templateQuotation) target.templateQuotation = input.templateQuotation
    if (input.templateInvoice) target.templateInvoice = input.templateInvoice
    if (input.templateTaxInvoice) target.templateTaxInvoice = input.templateTaxInvoice
    if (input.templateReceipt) target.templateReceipt = input.templateReceipt
    if (!existing) tem.persist(target)
    await tem.flush()
    return target
  })

  return Response.json(serialize(row))
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Documents',
  summary: 'Document settings',
  methods: {
    GET: {
      summary: 'Seller identity and default template per document type',
      tags: ['Orva Documents'],
      responses: [{ status: 200, description: 'Settings (defaults when unset).', schema: settingsSchema }],
      errors: [{ status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) }],
    },
    PUT: {
      summary: 'Upsert seller identity and template choices',
      tags: ['Orva Documents'],
      requestBody: { schema: settingsPutSchema },
      responses: [{ status: 200, description: 'Saved settings.', schema: settingsSchema }],
      errors: [
        { status: 400, description: 'Invalid payload (e.g. taxpayer id is not 13 digits)', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
