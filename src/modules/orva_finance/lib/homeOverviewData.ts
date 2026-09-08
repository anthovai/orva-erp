import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { PurchasingLateLine, PurchasingSummaryReader } from './purchasingSummary'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { daysBetween, monthBounds, monthOf, upcomingDeadlines, type TaxDeadline } from './homeOverview'
import { reminderState } from './reminders'
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
    items: Array<{
      id: string; ref: string; customer: string | null; dueDate: string | null; daysOverdue: number
      remaining: string; total: string
      /** How many times the invoice/tax invoice was emailed to the customer. */
      remindersSent: number
      /** Days since the last send, or null when never sent. */
      daysSinceReminder: number | null
      /** Overdue past the threshold and never chased. */
      neverReminded: boolean
      /** Quiet long enough (or never chased) to justify another nudge. */
      dueForReminder: boolean
    }>
    openTotal: string
    overdueTotal: string
    overdueCount: number
    /** Overdue invoices that have never been chased — the sharpest signal. */
    unremindedCount: number
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
    /** คลัง: lots still on hand that expire within 90 days / already expired. */
    expiringLots: number
    expiredLots: number
    /** IT: licences/domains renewing within 30 days / already lapsed. */
    renewingSubscriptions: number
    lapsedSubscriptions: number
    /** การตลาด: enquiries that became deals and have not moved off the first stage. */
    untouchedLeads: number
    /**
     * จัดซื้อ: ordered lines past their expected date with less received than
     * ordered. Empty when the purchasing module is not registered, which is
     * the honest answer: no purchase orders, nothing late.
     */
    latePurchaseLines: PurchasingLateLine[]
    /** จัดซื้อ: ex-VAT value of open orders no bill has covered yet. */
    committedNotBilled: string
    /** Quotes accepted by the customer with no งวด issued yet. */
    acceptedAwaitingInstallment: Array<{ id: string; ref: string; customer: string | null; total: string }>
  }
}

/**
 * Marventine lots that still hold stock but are running out of shelf life —
 * the one stock fact the owner must not miss on the home screen. A scalar
 * tenant-filtered read on the WMS tables, the same seam as the sales reads;
 * 90 days matches the 'soon' window on the stock valuation screen.
 */
async function stockExpiryAlerts(
  tem: EntityManager,
  scope: Scope,
  today: string,
): Promise<{ expiringLots: number; expiredLots: number }> {
  const rows = (await tem.execute(
    `select coalesce(count(*) filter (where x.expires_at >= ?::date), 0)::int as expiring,
            coalesce(count(*) filter (where x.expires_at < ?::date), 0)::int as expired
     from (
       select l.id, l.expires_at
       from wms_inventory_lots l
       join wms_inventory_balances b on b.lot_id = l.id and b.deleted_at is null
       where l.tenant_id = ?::uuid
         and (?::uuid is null or l.organization_id = ?::uuid)
         and l.deleted_at is null and l.expires_at is not null
         and l.expires_at <= ?::date + interval '90 days'
       group by l.id, l.expires_at
       having sum(b.quantity_on_hand) > 0
     ) x`,
    [today, today, scope.tenantId, scope.organizationId, scope.organizationId, today],
  )) as Array<{ expiring: number; expired: number }>
  return {
    expiringLots: Number(rows[0]?.expiring ?? 0),
    expiredLots: Number(rows[0]?.expired ?? 0),
  }
}

/**
 * When each invoice was last chased. Reads `orva_documents_sends` — the
 * append-only send log — through the same scalar tenant-filtered seam as the
 * other cross-module reads here. Only reminder-shaped documents count: an
 * invoice or its tax invoice going out IS the nudge, because the owner sends
 * the document itself rather than a separate letter.
 */
async function reminderHistory(
  tem: EntityManager,
  scope: Scope,
  invoiceIds: readonly string[],
): Promise<Map<string, string[]>> {
  if (!invoiceIds.length) return new Map()
  const rows = (await tem.execute(
    `select document_id::text as id, to_char(sent_at, 'YYYY-MM-DD') as on_date
     from orva_documents_sends
     where tenant_id = ?::uuid
       and (?::uuid is null or organization_id = ?::uuid)
       and document_type in ('invoice', 'tax_invoice', 'billing_note')
       and document_id = any(?::uuid[])
     order by sent_at`,
    [scope.tenantId, scope.organizationId, scope.organizationId, `{${invoiceIds.join(',')}}`],
  )) as Array<{ id: string; on_date: string }>
  const byInvoice = new Map<string, string[]>()
  for (const row of rows) {
    const list = byInvoice.get(row.id)
    if (list) list.push(row.on_date)
    else byInvoice.set(row.id, [row.on_date])
  }
  return byInvoice
}

/**
 * Quotes the customer accepted through the acceptance link but which have not
 * been billed at all. Upstream's accept route writes `status = 'confirmed'`
 * with a plain ORM write — no event — so this is derived rather than pushed,
 * which also self-heals: issue the งวด and the row disappears.
 *
 * Deliberately only the FIRST งวด. A part-billed quote always has a remainder,
 * so prompting on that would put a permanent row on a card whose every other
 * row can actually be cleared; billing progress lives on the Projects page.
 */
async function quotesAwaitingFirstInstallment(
  tem: EntityManager,
  scope: Scope,
): Promise<Array<{ id: string; ref: string; customerEntityId: string | null; total: string }>> {
  const rows = (await tem.execute(
    `select q.id::text, q.quote_number, q.customer_entity_id::text, q.grand_total_gross_amount::text as total
     from sales_quotes q
     where q.deleted_at is null and q.tenant_id = ?::uuid
       and (?::uuid is null or q.organization_id = ?::uuid)
       and q.status = 'confirmed'
       and not exists (
         select 1 from sales_invoices i
         where i.deleted_at is null and i.tenant_id = q.tenant_id
           and i.metadata->>'quoteId' = q.id::text
       )
     order by q.created_at desc
     limit 20`,
    [scope.tenantId, scope.organizationId, scope.organizationId],
  )) as Array<{ id: string; quote_number: string; customer_entity_id: string | null; total: string }>
  return rows.map((row) => ({
    id: row.id,
    ref: row.quote_number,
    customerEntityId: row.customer_entity_id,
    total: Number(row.total).toFixed(2),
  }))
}

/**
 * Licences, domains and certificates about to lapse. A subscription that dies
 * unnoticed takes a client's site with it, so it belongs on the home screen
 * next to the stock expiry — 30 days matches the register's lead window.
 */
async function subscriptionRenewals(
  tem: EntityManager,
  scope: Scope,
  today: string,
): Promise<{ renewingSubscriptions: number; lapsedSubscriptions: number }> {
  const rows = (await tem.execute(
    `select coalesce(count(*) filter (where renews_on >= ?::date), 0)::int as renewing,
            coalesce(count(*) filter (where renews_on < ?::date), 0)::int as lapsed
     from orva_support_subscriptions
     where tenant_id = ?::uuid
       and (?::uuid is null or organization_id = ?::uuid)
       and deleted_at is null and status = 'active' and renews_on is not null
       and renews_on <= ?::date + interval '30 days'`,
    [today, today, scope.tenantId, scope.organizationId, scope.organizationId, today],
  )) as Array<{ renewing: number; lapsed: number }>
  return {
    renewingSubscriptions: Number(rows[0]?.renewing ?? 0),
    lapsedSubscriptions: Number(rows[0]?.lapsed ?? 0),
  }
}

/**
 * Enquiries nobody has picked up.
 *
 * A deal still sitting on the FIRST stage of its pipeline is one nobody has
 * moved — which for a lead that arrived through the public form means nobody
 * has replied. Counted within 30 days because after that it is not a new
 * enquiry any more, it is a decision the owner has already made by not acting.
 *
 * The stage comparison is by position rather than by name, so renaming a
 * pipeline stage cannot silently switch this off. Note that
 * `customer_pipeline_stages` carries no `deleted_at` column — a stage is
 * removed outright — so do not add the soft-delete predicate the sibling
 * tables use here; it makes this query fail and the whole home screen 500. A scalar tenant-filtered
 * read on the CRM tables, the same seam the stock and subscription counts
 * above use.
 */
async function untouchedLeads(tem: EntityManager, scope: Scope, today: string): Promise<number> {
  const rows = (await tem.execute(
    `select count(*)::int as n
       from customer_deals d
       join customer_pipeline_stages s on s.id = d.pipeline_stage_id
      where d.tenant_id = ?::uuid
        and (?::uuid is null or d.organization_id = ?::uuid)
        and d.deleted_at is null
        and d.created_at >= ?::date - interval '30 days'
        and s.position = (
          select min(s2.position) from customer_pipeline_stages s2
           where s2.pipeline_id = s.pipeline_id
        )`,
    [scope.tenantId, scope.organizationId, scope.organizationId, today],
  )) as Array<{ n: number }>
  return Number(rows[0]?.n ?? 0)
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

/**
 * `purchasing` arrives as an optional reader rather than an import: the four
 * questions must render on an install that never registered that module. The
 * caller resolves it (see the overview route) and passes it in, so this file
 * stays free of DI plumbing.
 */
export async function buildHomeOverview(
  tem: EntityManager,
  scope: Scope,
  today: string,
  deps: { purchasing?: PurchasingSummaryReader | null } = {},
): Promise<HomeOverviewData> {
  const month = monthOf(today)
  const bounds = monthBounds(month)
  const [invoices, receipts, bank, quotes, books, stock, subs, leads, purchasing, accepted] = await Promise.all([
    openInvoices(tem, scope),
    receiptsInMonth(tem, scope, bounds.from, bounds.to),
    cashBalances(tem, scope),
    pendingQuotes(tem, scope),
    bookkeepingStatus(tem, scope, month, bounds.from, bounds.to),
    stockExpiryAlerts(tem, scope, today),
    subscriptionRenewals(tem, scope, today),
    untouchedLeads(tem, scope, today),
    deps.purchasing
      ? deps.purchasing.summarise(tem, { tenantId: scope.tenantId, organizationId: scope.organizationId ?? '' }, today)
      : Promise.resolve(null),
    quotesAwaitingFirstInstallment(tem, scope),
  ])
  const deadlines = upcomingDeadlines(today)
  const reminders = await reminderHistory(tem, scope, invoices.map((i) => i.id))
  const customerNames = await resolveCustomerNames(tem, scope, [
    ...quotes.map((q) => q.customer_entity_id),
    ...invoices.filter((i) => !i.customer_name).map((i) => i.customer_entity_id),
    ...accepted.map((a) => a.customerEntityId),
  ])

  const cashItems = invoices.map((row) => {
    const state = reminderState({ dueDate: row.due_date, reminderDates: reminders.get(row.id) ?? [] }, today)
    return {
      id: row.id,
      ref: row.invoice_number,
      customer: row.customer_name ?? (row.customer_entity_id ? customerNames.get(row.customer_entity_id) ?? null : null),
      dueDate: row.due_date,
      daysOverdue: state.daysOverdue,
      remaining: Number(row.remaining).toFixed(2),
      total: Number(row.total).toFixed(2),
      remindersSent: state.remindersSent,
      daysSinceReminder: state.daysSinceReminder,
      neverReminded: state.neverReminded,
      dueForReminder: state.dueForReminder,
    }
  })
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
      unremindedCount: overdue.filter((item) => item.neverReminded).length,
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
      expiringLots: stock.expiringLots,
      expiredLots: stock.expiredLots,
      renewingSubscriptions: subs.renewingSubscriptions,
      untouchedLeads: leads,
      latePurchaseLines: purchasing?.lateLines ?? [],
      committedNotBilled: (purchasing?.committedNotBilled ?? 0).toFixed(2),
      lapsedSubscriptions: subs.lapsedSubscriptions,
      acceptedAwaitingInstallment: accepted.map((row) => ({
        id: row.id,
        ref: row.ref,
        customer: row.customerEntityId ? customerNames.get(row.customerEntityId) ?? null : null,
        total: row.total,
      })),
    },
  }
}
