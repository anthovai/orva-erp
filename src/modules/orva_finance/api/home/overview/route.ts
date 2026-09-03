import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { daysBetween, isoDate, monthBounds, monthOf, upcomingDeadlines } from '../../../lib/homeOverview'
import {
  bookkeepingStatus, cashBalances, monthPackHistory, openInvoices, pendingQuotes, receiptsInMonth,
  vatReport, whtReport,
} from '../../../lib/reportQueries'
import { orvaFinanceTag } from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_finance.gl.view'] },
}

const querySchema = z.object({
  /** For tests and screenshots; defaults to today. */
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

const moneyRow = z.object({ id: z.string(), ref: z.string(), customer: z.string().nullable(), dueDate: z.string().nullable(), daysOverdue: z.number(), remaining: z.string(), total: z.string() })

const responseSchema = z.object({
  today: z.string(),
  month: z.string(),
  cashIn: z.object({
    items: z.array(moneyRow),
    openTotal: z.string(),
    overdueTotal: z.string(),
    overdueCount: z.number(),
  }),
  received: z.object({
    total: z.string(),
    cash: z.string(),
    wht: z.string(),
    count: z.number(),
    bank: z.array(z.object({ code: z.string(), name: z.string(), balance: z.string() })),
    bankTotal: z.string(),
  }),
  tax: z.array(z.object({
    kind: z.enum(['vat', 'wht']),
    period: z.string(),
    dueDate: z.string(),
    daysLeft: z.number(),
    state: z.enum(['upcoming', 'due_soon', 'overdue']),
    amount: z.string(),
    packSentAt: z.string().nullable(),
  })),
  waiting: z.object({
    quotes: z.array(z.object({ id: z.string(), ref: z.string(), customer: z.string().nullable(), validUntil: z.string().nullable(), daysLeft: z.number().nullable(), total: z.string() })),
    unpostedInvoices: z.number(),
    draftJournals: z.number(),
    unmatchedBankLines: z.number(),
    lastMonthPackSent: z.boolean(),
  }),
})

/**
 * The owner's four questions in one call:
 *   1. what money is due in (open invoices, overdue flagged)
 *   2. what came in this month (posted receipts, bank balances)
 *   3. which filings are coming (ภ.ง.ด. by the 7th, ภ.พ.30 by the 15th) and
 *      whether last month's pack already went to the accountant
 *   4. what is waiting on someone (unanswered quotes, unposted invoices,
 *      draft journals, unmatched bank lines)
 * Reads the same queries as the report screens, never its own numbers.
 */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const today = parsed.data.today ?? isoDate(new Date())
  const month = monthOf(today)
  const scope = { tenantId: auth.tenantId, organizationId: resolveActiveOrganizationId(auth) }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const result = await withTenantRls(em, scope.tenantId, async (tem) => {
    const bounds = monthBounds(month)
    const [invoices, receipts, bank, quotes, books, deadlines] = await Promise.all([
      openInvoices(tem, scope),
      receiptsInMonth(tem, scope, bounds.from, bounds.to),
      cashBalances(tem, scope),
      pendingQuotes(tem, scope),
      bookkeepingStatus(tem, scope, month, bounds.from, bounds.to),
      Promise.resolve(upcomingDeadlines(today)),
    ])

    const cashItems = invoices.map((row) => ({
      id: row.id,
      ref: row.invoice_number,
      customer: row.customer_name,
      dueDate: row.due_date,
      daysOverdue: row.due_date ? Math.max(0, daysBetween(row.due_date, today)) : 0,
      remaining: Number(row.remaining).toFixed(2),
      total: Number(row.total).toFixed(2),
    }))
    const overdue = cashItems.filter((item) => item.daysOverdue > 0)

    const sum = <T,>(rows: T[], key: keyof T) => rows.reduce((s, r) => s + Number(r[key] ?? 0), 0)

    // Filing amounts come from the same registers as the report screens.
    const periods = [...new Set(deadlines.map((d) => d.period))]
    const registers = new Map<string, { vat: string; wht: string }>()
    for (const period of periods) {
      const [vat, wht] = await Promise.all([vatReport(tem, scope, period), whtReport(tem, scope, period)])
      registers.set(period, { vat: vat.summary.netPayable, wht: wht.summary.payable })
    }
    const packs = await monthPackHistory(tem, scope)
    const sentFor = (period: string) => packs.find((p) => p.month === period && p.status === 'sent')?.sent_at ?? null

    return {
      today,
      month,
      cashIn: {
        items: cashItems,
        openTotal: sum(cashItems, 'remaining').toFixed(2),
        overdueTotal: sum(overdue, 'remaining').toFixed(2),
        overdueCount: overdue.length,
      },
      received: {
        total: sum(receipts, 'total').toFixed(2),
        cash: sum(receipts, 'cash').toFixed(2),
        wht: sum(receipts, 'wht').toFixed(2),
        count: receipts.length,
        bank: bank.map((b) => ({ ...b, balance: Number(b.balance).toFixed(2) })),
        bankTotal: sum(bank, 'balance').toFixed(2),
      },
      // ภ.พ.30 is due even when nil (a registrant files zero returns);
      // ภ.ง.ด.3/53 only exists when something was withheld.
      tax: deadlines
        .map((d) => ({
          ...d,
          amount: registers.get(d.period)?.[d.kind] ?? '0.00',
          packSentAt: sentFor(d.period),
        }))
        .filter((d) => d.kind === 'vat' || Number(d.amount) !== 0),
      waiting: {
        quotes: quotes.map((q) => ({
          id: q.id,
          ref: q.quote_number,
          customer: q.customer_name,
          validUntil: q.valid_until,
          daysLeft: q.valid_until ? daysBetween(today, q.valid_until) : null,
          total: Number(q.total).toFixed(2),
        })),
        unpostedInvoices: books.unpostedInvoices,
        draftJournals: books.draftJournals,
        unmatchedBankLines: books.unmatchedBankLines,
        lastMonthPackSent: sentFor(periods[periods.length - 1] ?? month) != null,
      },
    }
  })
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
