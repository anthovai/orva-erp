import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { orderIdParamsSchema } from '../../../../data/validators'
import { findOrder } from '../../../../lib/orders'
import { billLines, findUnlinkedBills } from '../../../../lib/bills'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_purchasing.view', 'orva_finance.ap.view'] },
}

const responseSchema = z.object({
  bills: z.array(
    z.object({
      id: z.string(),
      billNo: z.string().nullable(),
      billDate: z.string(),
      status: z.string(),
      totalAmount: z.number(),
      vendorBillRef: z.string().nullable(),
      unlinkedLines: z.number(),
      lines: z.array(
        z.object({
          lineNo: z.number(),
          amount: z.number(),
          description: z.string().nullable(),
          accountId: z.string(),
          accountCode: z.string().nullable(),
          linked: z.boolean(),
        }),
      ),
    }),
  ),
})

/**
 * This vendor's bills with a line nobody has allocated yet.
 *
 * The recovery surface for the gap the two-step link leaves: the bill landed
 * in the ledger, the link call did not, and the order silently under-reports
 * what it has been charged. Offering only this order's vendor keeps the list
 * short and makes a wrong pairing hard.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const params = orderIdParamsSchema.safeParse(await ctx.params)
  if (!params.success) return Response.json({ error: 'ไม่พบใบสั่งซื้อ' }, { status: 404 })
  const scope = { tenantId: auth.tenantId, organizationId }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const bills = await withTenantRls(em, scope.tenantId, async (tem) => {
      const order = await findOrder(tem, scope, params.data.id)
      const candidates = await findUnlinkedBills(tem, scope, order.vendorPartyId)
      return Promise.all(
        candidates.map(async (bill) => ({
          ...bill,
          lines: (await billLines(tem, scope, bill.id)).map((line) => ({
            lineNo: line.lineNo,
            amount: line.amount,
            description: line.description,
            accountId: line.accountId,
            accountCode: line.accountCode,
            linked: line.linkedOrderId != null,
          })),
        })),
      )
    })
    return Response.json({ bills })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json({ error: error instanceof Error ? error.message : 'Lookup failed' }, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Purchasing',
  summary: 'Vendor bills not yet linked to this order',
  methods: {
    GET: {
      summary: 'Bills of this order’s vendor that still have an unallocated line',
      tags: ['Orva Purchasing'],
      responses: [{ status: 200, description: 'Bills.', schema: responseSchema }],
      errors: [{ status: 404, description: 'No such order', schema: z.object({ error: z.string() }) }],
    },
  },
}
