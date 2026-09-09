import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import {
  resolveActiveOrganizationId,
  organizationScopeRequiredResponse,
} from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { shareDocumentSchema } from '../../data/validators'
import { isShareable } from '../../lib/document'
import { mintShareLink } from '../../lib/shareLinks'
import { findInvoiceById } from '../../lib/source'

const logger = createLogger('orva_documents').child({ component: 'share-document' })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['sales.invoices.manage'] },
}

const responseSchema = z.object({
  url: z.string(),
  validUntil: z.string().nullable(),
})

/**
 * Mints the public link for a document that is not a quotation — today the
 * ใบส่งของ printed from an invoice.
 *
 * The quote link is the sales module's acceptance token and the `share` route
 * next door rotates that. This one writes its own row, because an invoice
 * carries no token a driver could be handed. Same rotation semantics: every
 * call revokes the earlier links for the same invoice and type, and the UI
 * says so.
 *
 * Only `SHAREABLE_TYPES` pass: a delivery note proves custody of goods and
 * states no tax, so the customer's warehouse may hold the link. A ใบกำกับภาษี
 * never goes out this way — the schema refuses the type before anything is
 * read.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()

  const parsed = shareDocumentSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) {
    return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  }
  const { documentId, type, expiresInDays } = parsed.data
  if (!isShareable(type)) {
    return Response.json({ error: `${type} cannot be shared by link` }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const tenantId = auth.tenantId

  try {
    const minted = await withTenantRls(em, tenantId, async (tem) => {
      const invoice = await findInvoiceById(tem, { invoiceId: documentId, tenantId })
      if (!invoice || String(invoice.organization_id ?? '') !== organizationId) return null
      return mintShareLink(tem, {
        tenantId,
        organizationId,
        sourceKind: 'invoice',
        sourceId: documentId,
        documentType: type,
        expiresInDays,
        createdBy: auth.sub ?? null,
      })
    })
    if (!minted) return Response.json({ error: 'Invoice not found' }, { status: 404 })

    const origin = (process.env.APP_URL || new URL(req.url).origin).replace(/\/$/, '')
    return Response.json({
      url: `${origin}/documents/${minted.rawToken}`,
      validUntil: minted.link.expiresAt ? minted.link.expiresAt.toISOString().slice(0, 10) : null,
    })
  } catch (error) {
    logger.error('Share link mint failed', {
      documentId,
      type,
      err: error instanceof Error ? error.message : String(error),
    })
    return Response.json({ error: 'Could not create the customer link' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Documents',
  summary: 'Customer link for a non-quotation document (ใบส่งของ)',
  methods: {
    POST: {
      summary: 'Mint (rotate) the public link for a delivery note',
      description:
        'Returns a public URL for the given invoice printed as the given shareable type. Every call revokes the earlier links for the same invoice and type. Statutory tax documents are refused.',
      tags: ['Orva Documents'],
      requestBody: { schema: shareDocumentSchema },
      responses: [{ status: 200, description: 'The customer link.', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid payload or a type that cannot be shared', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Invoice not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
