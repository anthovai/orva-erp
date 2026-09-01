import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import {
  resolveActiveOrganizationId,
  organizationScopeRequiredResponse,
} from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { previewQuerySchema } from '../../data/validators'
import type { TemplateId } from '../../lib/document'
import {
  documentFromQuote,
  findInvoiceById,
  findQuoteById,
  listQuoteSources,
  loadSettings,
  sampleDocument,
  sourceOption,
} from '../../lib/source'

const logger = createLogger('orva_documents').child({ component: 'preview' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_documents.view'] },
}

const sourceOptionSchema = z.object({
  id: z.string(),
  number: z.string(),
  issueDate: z.string().nullable(),
  customerName: z.string().nullable(),
})

const responseSchema = z.object({
  document: z.record(z.string(), z.unknown()),
  sources: z.array(sourceOptionSchema),
  usedSample: z.boolean(),
})

/**
 * Renders any Thai document type from a sales quote. The same record can be
 * issued as a quotation, an invoice, a tax invoice or a receipt — that is how
 * Thai practice works, the heading and statutory block change, the figures do
 * not. Falls back to sample data so the screen is useful on an empty tenant.
 */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const url = new URL(req.url)
  const parsed = previewQuerySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const { type, documentId } = parsed.data
  const template = parsed.data.template as TemplateId | undefined

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const tenantId = auth.tenantId

  try {
    // Quote reads run OUTSIDE withTenantRls, mirroring the sales module's own
    // routes: the encryption subscriber does not decrypt inside our RLS
    // transaction (empirically — the same read decrypts on a plain fork and
    // returns ciphertext inside the transaction), and a sheet printing
    // ciphertext is worse than app-level scoping. Every query still filters
    // by tenantId explicitly, exactly as sales' public route does.
    const forked = em.fork()
    const sourceRows = await listQuoteSources(forked, { tenantId, organizationId })
    // documentId may name a quote or an issued invoice — try in that order
    const row = documentId
      ? (await findQuoteById(forked, { quoteId: documentId, tenantId }))
        ?? (await findInvoiceById(forked, { invoiceId: documentId, tenantId }))
      : null
    if (row?.kind === 'invoice' && type === 'quotation') {
      // an invoice record cannot be re-presented as the quotation it came from
      return Response.json({ error: 'A quotation cannot be printed from an invoice record' }, { status: 400 })
    }
    const { document, sources, usedSample } = await withTenantRls(em, tenantId, async (tem) => {
      const settings = await loadSettings(tem, { tenantId, organizationId })
      return {
        sources: sourceRows,
        usedSample: !row,
        document: row
          ? await documentFromQuote(tem, { row, type, template, settings })
          : sampleDocument({ type, template, settings }),
      }
    })

    return Response.json({ document, usedSample, sources: sources.map(sourceOption) })
  } catch (error) {
    // A preview must never 500 opaquely — the operator needs to know whether
    // the record or the settings are at fault.
    logger.error('Document preview build failed', {
      type,
      documentId: documentId ?? null,
      err: error instanceof Error ? error.message : String(error),
    })
    return Response.json({ error: 'Could not build the document preview' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Documents',
  summary: 'Document preview model',
  methods: {
    GET: {
      summary: 'Build a printable document from a sales record (or sample data)',
      description:
        'Returns the presentation model for the requested Thai document type and template. Omit documentId to render built-in sample data.',
      tags: ['Orva Documents'],
      query: previewQuerySchema,
      responses: [{ status: 200, description: 'Printable document plus selectable sources.', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid query', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
