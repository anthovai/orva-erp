import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { GlSettings } from '../../../data/entities'
import { monthPackQuerySchema } from '../../../data/validators'
import { packFileName, planMonthPack } from '../../../lib/monthPack'
import { monthPackHistory } from '../../../lib/reportQueries'
import { orvaFinanceTag } from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_finance.gl.view'] },
}

const responseSchema = z.object({
  month: z.string(),
  from: z.string(),
  to: z.string(),
  fileName: z.string(),
  companyName: z.string().nullable(),
  figures: z.object({
    vatOutput: z.number(), vatInput: z.number(), vatNet: z.number(),
    whtPayable: z.number(), whtReceivable: z.number(),
    income: z.number(), expense: z.number(), netProfit: z.number(),
    cashClosing: z.number(), journalCount: z.number(), taxDocumentCount: z.number(), bankUnmatched: z.number(),
  }),
  checklist: z.object({
    draftJournals: z.number(),
    unpostedInvoices: z.number(),
    unmatchedBankLines: z.number(),
    periodStatus: z.enum(['open', 'closed', 'missing']),
  }),
  files: z.array(z.string()),
  taxDocuments: z.array(z.object({ id: z.string(), invoice_number: z.string(), paid_date: z.string(), customer_name: z.string().nullable(), total: z.string() })),
  accountant: z.object({ email: z.string().nullable(), name: z.string().nullable() }),
  history: z.array(z.object({
    id: z.string(), month: z.string(), status: z.string(), file_name: z.string(), file_size: z.number(),
    sent_to: z.string().nullable(), sent_at: z.string().nullable(), created_at: z.string(),
  })),
})

/**
 * ชุดปิดเดือน pre-flight: the figures the pack will carry, what is still
 * loose in the books, which tax documents will be attached, the accountant
 * on file and every earlier pack for the month. Nothing is generated here —
 * `download` and `send` do that with the same plan.
 */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = monthPackQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const scope = { tenantId: auth.tenantId, organizationId: resolveActiveOrganizationId(auth) }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const result = await withTenantRls(em, scope.tenantId, async (tem) => {
    const plan = await planMonthPack(tem, scope, parsed.data.month)
    const history = await monthPackHistory(tem, scope, parsed.data.month)
    const settings = scope.organizationId
      ? await tem.findOne(GlSettings, { tenantId: scope.tenantId, organizationId: scope.organizationId })
      : null
    return {
      month: plan.month,
      from: plan.from,
      to: plan.to,
      fileName: packFileName(plan.month),
      companyName: plan.companyName,
      figures: plan.figures,
      checklist: plan.checklist,
      files: plan.entries.map((e) => e.name),
      taxDocuments: plan.taxDocuments,
      accountant: { email: settings?.accountantEmail ?? null, name: settings?.accountantName ?? null },
      history: history.map(({ summary: _summary, ...row }) => row),
    }
  })
  return Response.json(result)
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaFinanceTag,
  summary: 'Month pack (ชุดปิดเดือน) pre-flight',
  methods: {
    GET: {
      summary: 'Figures, checklist, attached documents and send history for one month',
      tags: [orvaFinanceTag],
      query: monthPackQuerySchema,
      responses: [{ status: 200, description: 'Month pack plan.', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid query', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
