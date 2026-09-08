import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { isoDate } from '../../../lib/homeOverview'
import { buildHomeOverview } from '../../../lib/homeOverviewData'
import { orvaFinanceTag } from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_finance.gl.view'] },
}

const querySchema = z.object({
  /** For tests and screenshots; defaults to today. */
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

const moneyRow = z.object({
  id: z.string(), ref: z.string(), customer: z.string().nullable(), dueDate: z.string().nullable(),
  daysOverdue: z.number(), remaining: z.string(), total: z.string(),
  remindersSent: z.number(), daysSinceReminder: z.number().nullable(),
  neverReminded: z.boolean(), dueForReminder: z.boolean(),
})

const responseSchema = z.object({
  today: z.string(),
  month: z.string(),
  cashIn: z.object({
    items: z.array(moneyRow), openTotal: z.string(), overdueTotal: z.string(),
    overdueCount: z.number(), unremindedCount: z.number(),
  }),
  received: z.object({
    total: z.string(), cash: z.string(), wht: z.string(), count: z.number(),
    bank: z.array(z.object({ code: z.string(), name: z.string(), balance: z.string() })),
    bankTotal: z.string(),
  }),
  tax: z.array(z.object({
    kind: z.enum(['vat', 'wht']), period: z.string(), dueDate: z.string(), daysLeft: z.number(),
    state: z.enum(['upcoming', 'due_soon', 'overdue']), amount: z.string(), packSentAt: z.string().nullable(),
  })),
  waiting: z.object({
    quotes: z.array(z.object({ id: z.string(), ref: z.string(), customer: z.string().nullable(), validUntil: z.string().nullable(), daysLeft: z.number().nullable(), total: z.string() })),
    unpostedInvoices: z.number(),
    draftJournals: z.number(),
    unmatchedBankLines: z.number(),
    lastMonthPackSent: z.boolean(),
    expiringLots: z.number(),
    expiredLots: z.number(),
    renewingSubscriptions: z.number(),
    lapsedSubscriptions: z.number(),
    untouchedLeads: z.number(),
    acceptedAwaitingInstallment: z.array(z.object({
      id: z.string(), ref: z.string(), customer: z.string().nullable(), total: z.string(),
    })),
  }),
})

/** The owner's four questions in one call — see lib/homeOverviewData.ts. */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const today = parsed.data.today ?? isoDate(new Date())
  const scope = { tenantId: auth.tenantId, organizationId: resolveActiveOrganizationId(auth) }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const result = await withTenantRls(em, scope.tenantId, (tem) => buildHomeOverview(tem, scope, today))
  return Response.json(result)
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaFinanceTag,
  summary: 'Owner home overview (four questions)',
  methods: {
    GET: {
      summary: 'Money due in, money received this month, filings coming up, documents waiting',
      tags: [orvaFinanceTag],
      query: querySchema,
      responses: [{ status: 200, description: 'Home overview.', schema: responseSchema }],
      errors: [{ status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) }],
    },
  },
}
