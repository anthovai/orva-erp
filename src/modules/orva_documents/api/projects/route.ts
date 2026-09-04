import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import {
  resolveActiveOrganizationId,
  organizationScopeRequiredResponse,
} from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { listProjects } from '../../lib/projects'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_documents.view'] },
}

const projectSchema = z.object({
  quoteId: z.string().uuid(),
  quoteNumber: z.string(),
  customerName: z.string().nullable(),
  currencyCode: z.string(),
  issueDate: z.string().nullable(),
  quoteStatus: z.string().nullable(),
  quoteTotal: z.number(),
  installments: z.number().int(),
  unpaidInstallments: z.number().int(),
  billed: z.number(),
  paid: z.number(),
  lastInvoiceDate: z.string().nullable(),
  status: z.enum(['not_started', 'billing', 'billed', 'complete']),
  billedPct: z.number(),
  paidPct: z.number(),
  remainingToBill: z.number(),
  remainingToCollect: z.number(),
  openTickets: z.number().int(),
})

/** Every quote as a project with its installment-billing progress. */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const items = await withTenantRls(em, auth.tenantId, (tem) =>
    listProjects(tem, { tenantId: auth.tenantId!, organizationId }),
  )
  return Response.json({ items })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Documents',
  summary: 'Projects (quotes with billing progress)',
  methods: {
    GET: {
      summary: 'Quotes as projects: total, งวด issued, billed/paid amounts and progress',
      tags: ['Orva Documents'],
      responses: [{ status: 200, description: 'Project rows, newest quote first.', schema: z.object({ items: z.array(projectSchema) }) }],
      errors: [{ status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) }],
    },
  },
}
