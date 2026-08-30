import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { buildAging, type AgingItemInput } from '../../../lib/aging'
import { orvaFinanceTag } from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_finance.gl.view'] },
}

const querySchema = z.object({
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

const agingRowSchema = z.object({
  ref: z.string(),
  partyName: z.string().nullable(),
  dueDate: z.string().nullable(),
  daysOverdue: z.number(),
  bucket: z.enum(['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus']),
  remaining: z.string(),
})

const sideSchema = z.object({
  rows: z.array(agingRowSchema),
  totals: z.object({
    current: z.string(), d1_30: z.string(), d31_60: z.string(), d61_90: z.string(), d90_plus: z.string(), total: z.string(),
  }),
})

const responseSchema = z.object({ asOf: z.string(), ap: sideSchema, ar: sideSchema })

/**
 * AP/AR aging as of a date.
 * AP: posted vendor bills with remaining = total - paid, aged by due date
 *     (falling back to bill date), with the vendor party name.
 * AR: GL-posted sales invoices with remaining = posting amount - posted
 *     receipt allocations, aged by the invoice's due date (fallback issue
 *     date).
 */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const asOf = parsed.data.asOf ?? new Date().toISOString().slice(0, 10)
  const tenantId = auth.tenantId
  const organizationId = resolveActiveOrganizationId(auth)
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const { apItems, arItems } = await withTenantRls(em, tenantId, async (tem) => {
    const ap = (await tem.execute(
      `select b.bill_no as ref,
              p.display_name as party_name,
              to_char(b.due_date, 'YYYY-MM-DD') as due_date,
              to_char(b.bill_date, 'YYYY-MM-DD') as document_date,
              (b.total_amount - b.paid_amount)::text as remaining
       from orva_ap_bills b
       left join orva_parties p on p.id = b.vendor_party_id and p.deleted_at is null
       where b.deleted_at is null
         and b.status = 'posted'
         and b.tenant_id = ?::uuid
         and (?::uuid is null or b.organization_id = ?::uuid)
         and b.total_amount - b.paid_amount > 0.00005
       limit 500`,
      [tenantId, organizationId ?? null, organizationId ?? null],
    )) as Array<Record<string, unknown>>

    const ar = (await tem.execute(
      `select ip.invoice_number as ref,
              null as party_name,
              to_char(si.due_date, 'YYYY-MM-DD') as due_date,
              coalesce(to_char(si.issue_date, 'YYYY-MM-DD'), to_char(ip.created_at, 'YYYY-MM-DD')) as document_date,
              (ip.amount - coalesce(r.received, 0))::text as remaining
       from orva_ar_invoice_postings ip
       left join sales_invoices si on si.id = ip.invoice_id
       left join (
         select a.invoice_id, sum(a.amount) as received
         from orva_ar_receipt_allocations a
         join orva_ar_receipts rc on rc.id = a.receipt_id and rc.status = 'posted' and rc.deleted_at is null
         where a.deleted_at is null
         group by a.invoice_id
       ) r on r.invoice_id = ip.invoice_id
       where ip.tenant_id = ?::uuid
         and (?::uuid is null or ip.organization_id = ?::uuid)
         and ip.amount - coalesce(r.received, 0) > 0.00005
       limit 500`,
      [tenantId, organizationId ?? null, organizationId ?? null],
    )) as Array<Record<string, unknown>>

    const toItems = (rows: Array<Record<string, unknown>>): AgingItemInput[] =>
      rows.map((row) => ({
        ref: String(row.ref ?? ''),
        partyName: (row.party_name as string | null) ?? null,
        dueDate: (row.due_date as string | null) ?? null,
        documentDate: (row.document_date as string | null) ?? null,
        remaining: String(row.remaining ?? '0'),
      }))
    return { apItems: toItems(ap), arItems: toItems(ar) }
  })

  return Response.json({
    asOf,
    ap: buildAging(asOf, apItems),
    ar: buildAging(asOf, arItems),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaFinanceTag,
  summary: 'AP/AR aging report',
  methods: {
    GET: {
      summary: 'Open payables and receivables bucketed by days overdue',
      description: 'Buckets: current (not due), 1–30, 31–60, 61–90, 90+ days, measured against the as-of date (default today).',
      tags: [orvaFinanceTag],
      query: querySchema,
      responses: [{ status: 200, description: 'AP and AR aging with bucket totals.', schema: responseSchema }],
      errors: [{ status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) }],
    },
  },
}
