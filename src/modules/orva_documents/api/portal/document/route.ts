import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { documentLabels } from '../../../lib/labels'
import { documentFromQuote, findInvoiceById, findQuoteById, loadSettings } from '../../../lib/source'
import { customerOwnsDocument } from '../../../lib/portalDocuments'

// The route authenticates the customer itself; staff auth does not apply.
export const metadata = {
  GET: { requireAuth: false },
}

const querySchema = z.object({
  id: z.string().uuid(),
  /** Which sheet to print; a quotation record prints one, an invoice the billing three. */
  type: z.enum(['quotation', 'invoice', 'tax_invoice', 'receipt']).optional(),
})

/**
 * One of the customer's own documents, as the printable sheet.
 *
 * Ownership is checked against the session's customer entity before anything
 * is read, and a document that is not theirs answers 404 exactly like an id
 * that does not exist — a customer must not be able to learn that somebody
 * else's invoice exists by guessing.
 *
 * The sheet is built by the same `documentFromQuote` the staff preview uses,
 * so the customer sees the tenant's real template rather than a second,
 * drifting rendering of the same paperwork.
 */
export async function GET(req: Request) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const customerEntityId = auth.customerEntityId ?? null
  if (!customerEntityId) return Response.json({ error: 'Not found' }, { status: 404 })
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const kind = await withTenantRls(em, scope.tenantId, (tem) =>
    customerOwnsDocument(tem, scope, customerEntityId, parsed.data.id))
  if (!kind) return Response.json({ error: 'Not found' }, { status: 404 })

  // A quotation record prints a quotation; an invoice record prints the
  // billing sheets. Asking for the wrong pairing is the caller's mistake, not
  // a reason to print the wrong document.
  const type = parsed.data.type ?? (kind === 'quote' ? 'quotation' : 'invoice')
  if (kind === 'quote' && type !== 'quotation') return Response.json({ error: 'Invalid type for this document' }, { status: 400 })
  if (kind === 'invoice' && type === 'quotation') return Response.json({ error: 'Invalid type for this document' }, { status: 400 })

  const document = await withTenantRls(em, scope.tenantId, async (tem) => {
    const row = kind === 'quote'
      ? await findQuoteById(tem, { quoteId: parsed.data.id, tenantId: scope.tenantId })
      : await findInvoiceById(tem, { invoiceId: parsed.data.id, tenantId: scope.tenantId })
    if (!row) return null
    const settings = await loadSettings(tem, { tenantId: scope.tenantId, organizationId: scope.organizationId })
    return documentFromQuote(tem, { row, type, settings })
  })
  if (!document) return Response.json({ error: 'Not found' }, { status: 404 })

  return Response.json({ document, labels: await documentLabels(), kind })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Documents',
  summary: "Portal — one of the customer's documents",
  methods: {
    GET: {
      summary: "The printable sheet for a document the signed-in customer owns; anything else is a 404",
      tags: ['Orva Documents'],
      query: querySchema,
      responses: [{ status: 200, description: 'The document and its Thai sheet labels.', schema: z.object({ document: z.record(z.string(), z.unknown()), labels: z.record(z.string(), z.string()), kind: z.string() }) }],
      errors: [{ status: 404, description: 'Not the customer\'s document', schema: z.object({ error: z.string() }) }],
    },
  },
}
