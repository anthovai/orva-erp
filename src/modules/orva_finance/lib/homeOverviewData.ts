import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { daysBetween, monthBounds, monthOf, upcomingDeadlines, type TaxDeadline } from './homeOverview'
import {
  bookkeepingStatus, cashBalances, monthPackHistory, openInvoices, pendingQuotes, receiptsInMonth,
  vatReport, whtReport, type Scope,
} from './reportQueries'

/**
 * The owner's four questions, assembled once for the home screen, the
 * dashboard widget and the assistant's `get_home_overview` tool:
 *   1. what money is due in (open invoices, overdue flagged)
 *   2. what came in this month (posted receipts, bank balances)
 *   3. which filings are coming (ภ.ง.ด. by the 7th, ภ.พ.30 by the 15th) and
 *      whether last month's pack already went to the accountant
 *   4. what is waiting on someone (unanswered quotes, unposted invoices,
 *      draft journals, unmatched bank lines)
 * Reads the same queries as the report screens, never its own numbers.
 */
export type HomeOverviewData = {
  today: string
  month: string
  cashIn: {
    items: Array<{ id: string; ref: string; customer: string | null; dueDate: string | null; daysOverdue: number; remaining: string; total: string }>
    openTotal: string
    overdueTotal: string
    overdueCount: number
  }
  received: {
    total: string; cash: string; wht: string; count: number
    bank: Array<{ code: string; name: string; balance: string }>
    bankTotal: string
  }
  tax: Array<TaxDeadline & { amount: string; packSentAt: string | null }>
  waiting: {
    quotes: Array<{ id: string; ref: string; customer: string | null; validUntil: string | null; daysLeft: number | null; total: string }>
    unpostedInvoices: number
    draftJournals: number
    unmatchedBankLines: number
    lastMonthPackSent: boolean
  }
}

/** Customer display names live encrypted in customer_entities; resolve the few we show. */
export async function resolveCustomerNames(tem: EntityManager, scope: Scope, ids: Array<string | null | undefined>): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))]
  const names = new Map<string, string | null>()
  if (!unique.length) return names
  const entities = await findWithDecryption(tem, CustomerEntity, { id: { $in: unique } }, {}, { tenantId: scope.tenantId, organizationId: scope.organizationId ?? undefined })
  for (const entity of entities) names.set(String(entity.id), (entity as { displayName?: string | null }).displayName ?? null)
  return names
}

export async function buildHomeOverview(tem: EntityManager, scope: Scope, today: string): Promise<HomeOverviewData> {
  const month = monthOf(today)
  const bounds = monthBounds(month)
  const [invoices, receipts, bank, quotes, books] = await Promise.all([
    openInvoices(tem, scope),
    receiptsInMonth(tem, scope, bounds.from, bounds.to),
    cashBalances(tem, scope),
    pendingQuotes(tem, scope),
    bookkeepingStatus(tem, scope, month, bounds.from, bounds.to),
  ])
  const deadlines = upcomingDeadlines(today)
  const customerNames = await resolveCustomerNames(tem, scope, [
    ...quotes.map((q) => q.customer_entity_id),
    ...invoices.filter((i) => !i.customer_name).map((i) => i.customer_entity_id),
  ])

  const cashItems = invoices.map((row) => ({
    id: row.id,
    ref: row.invoice_number,
    customer: row.customer_name ?? (row.customer_entity_id ? customerNames.get(row.customer_entity_id) ?? null : null),
    dueDate: row.due_date,
    daysOverdue: row.due_date ? Math.max(0, daysBetween(row.due_date, today)) : 0,
    remaining: Number(row.remaining).toFixed(2),
    total: Number(row.total).toFixed(2),
  }))
  const overdue = cashItems.filter((item) => item.daysOverdue > 0)
  const sum = <T,>(rows: T[], key: keyof T) => rows.reduce((s, r) => s + Number(r[key] ?? 0), 0)

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
      .map((d) => ({ ...d, amount: registers.get(d.period)?.[d.kind] ?? '0.00', packSentAt: sentFor(d.period) }))
      .filter((d) => d.kind === 'vat' || Number(d.amount) !== 0),
    waiting: {
      quotes: quotes.map((q) => ({
        id: q.id,
        ref: q.quote_number,
        customer: (q.customer_entity_id ? customerNames.get(q.customer_entity_id) : null) ?? null,
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
}
