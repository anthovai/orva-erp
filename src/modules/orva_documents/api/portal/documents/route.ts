import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { loadPortalDocuments } from '../../../lib/portalDocuments'

// The route authenticates the customer itself; staff auth does not apply.
export const metadata = {
  GET: { requireAuth: false },
}

const quoteSchema = z.object({
  id: z.string(), number: z.string(), issueDate: z.string().nullable(), validUntil: z.string().nullable(),
  total: z.number(), currency: z.string(), billed: z.boolean(),
})
const invoiceSchema = z.object({
  id: z.string(), number: z.string(), issueDate: z.string().nullable(), dueDate: z.string().nullable(),
  paidDate: z.string().nullable(), total: z.number(), outstanding: z.number(), currency: z.string(),
  quoteNumber: z.string().nullable(), installmentNo: z.number().nullable(),
})
const responseSchema = z.object({
  linked: z.boolean(),
  quotes: z.array(quoteSchema),
  invoices: z.array(invoiceSchema),
  summary: z.object({ outstanding: z.number(), unpaidCount: z.number(), currency: z.string() }),
})

/**
 * A customer's own quotations and invoices.
 *
 * Scope comes from the session's customer entity, never from the query, so
 * there is no id a caller could supply to read somebody else's paperwork.
 *
 * A portal account that is not linked to a customer record answers
 * `linked: false` with empty lists rather than pretending the customer has no
 * documents — the two look identical to a reader and mean opposite things.
 */
export async function GET(req: Request) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const customerEntityId = auth.customerEntityId ?? null
  const empty = { quotes: [], invoices: [], summary: { outstanding: 0, unpaidCount: 0, currency: 'THB' } }
  if (!customerEntityId) return Response.json({ linked: false, ...empty })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }
  const data = await withTenantRls(em, scope.tenantId, (tem) => loadPortalDocuments(tem, scope, customerEntityId))
  return Response.json({ linked: true, ...data })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Documents',
  summary: 'Portal — the customer\'s own documents',
  methods: {
    GET: {
      summary: "Quotations and invoices belonging to the signed-in customer, with the outstanding total",
      tags: ['Orva Documents'],
      responses: [{ status: 200, description: 'The customer\'s documents.', schema: responseSchema }],
      errors: [{ status: 401, description: 'No customer session', schema: z.object({ error: z.string() }) }],
    },
  },
}
