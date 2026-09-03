import type { EntityManager } from '@mikro-orm/postgresql'
import type { AccountSums } from './statements'

/**
 * The SQL behind Orva's finance reports, shared by the report API routes,
 * the home screen and the ชุดปิดเดือน builder — so the pack the accountant
 * receives can never disagree with the screens the owner looked at.
 *
 * Every function expects an EntityManager already inside withTenantRls; the
 * tenant/organization predicates are still spelled out so a call outside RLS
 * (a worker, a CLI) stays scoped.
 */
export type Scope = { tenantId: string; organizationId: string | null }

const org = (scope: Scope) => [scope.organizationId ?? null, scope.organizationId ?? null]

// ---------------------------------------------------------------- VAT ------

export type VatSalesRow = {
  date: string; document_no: string; customer_name: string | null; customer_tax_id: string | null
  customer_branch: string | null; base: string; vat: string; total: string
}
export type VatPurchaseRow = {
  date: string; document_no: string; vendor_ref: string | null; vendor_name: string | null
  vendor_tax_id: string | null; base: string; vat: string; total: string
}
export type VatReport = {
  month: string
  sales: VatSalesRow[]
  purchases: VatPurchaseRow[]
  summary: { outputBase: string; outputVat: string; inputBase: string; inputVat: string; netPayable: string }
}

/**
 * Tax point for a service business is the RECEIPT, so a sales invoice enters
 * the output register in the month of its paidDate. Purchases are posted
 * vendor bills carrying input VAT, by bill date.
 */
export async function vatReport(tem: EntityManager, scope: Scope, month: string): Promise<VatReport> {
  const sales = (await tem.execute(
    `select i.metadata->>'paidDate' as date,
            i.invoice_number as document_no,
            coalesce(i.metadata->'customerSnapshot'->'customer'->>'displayName',
                     i.metadata->'customerSnapshot'->>'displayName') as customer_name,
            (select v.value_text from custom_field_values v
               where v.field_key = 'th_tax_id' and v.deleted_at is null and v.tenant_id = i.tenant_id
                 and v.record_id in (
                   i.metadata->>'customerEntityId',
                   (select c.id::text from customer_companies c
                      where c.entity_id::text = i.metadata->>'customerEntityId' limit 1)
                 ) limit 1) as customer_tax_id,
            (select v.value_text from custom_field_values v
               where v.field_key = 'th_branch_code' and v.deleted_at is null and v.tenant_id = i.tenant_id
                 and v.record_id in (
                   i.metadata->>'customerEntityId',
                   (select c.id::text from customer_companies c
                      where c.entity_id::text = i.metadata->>'customerEntityId' limit 1)
                 ) limit 1) as customer_branch,
            i.grand_total_net_amount::text as base,
            i.tax_total_amount::text as vat,
            i.grand_total_gross_amount::text as total
     from sales_invoices i
     where i.deleted_at is null and i.tenant_id = ?::uuid
       and (?::uuid is null or i.organization_id = ?::uuid)
       and i.tax_total_amount > 0
       and left(i.metadata->>'paidDate', 7) = ?
     union all
     -- ใบลดหนี้ enter the register as negatives, ใบเพิ่มหนี้ as positives, by issue date
     select to_char(m.issue_date, 'YYYY-MM-DD') as date,
            m.credit_memo_number as document_no,
            coalesce(m.metadata->'customerSnapshot'->'customer'->>'displayName',
                     m.metadata->'customerSnapshot'->>'displayName') as customer_name,
            m.metadata->>'customerTaxId' as customer_tax_id,
            m.metadata->>'customerBranch' as customer_branch,
            (case when m.metadata->>'noteKind' = 'debit' then 1 else -1 end * m.grand_total_net_amount)::text as base,
            (case when m.metadata->>'noteKind' = 'debit' then 1 else -1 end * m.tax_total_amount)::text as vat,
            (case when m.metadata->>'noteKind' = 'debit' then 1 else -1 end * m.grand_total_gross_amount)::text as total
     from sales_credit_memos m
     where m.deleted_at is null and m.tenant_id = ?::uuid
       and (?::uuid is null or m.organization_id = ?::uuid)
       and m.tax_total_amount > 0
       and to_char(m.issue_date, 'YYYY-MM') = ?
     order by 1, 2`,
    [scope.tenantId, ...org(scope), month, scope.tenantId, ...org(scope), month],
  )) as VatSalesRow[]

  const purchases = (await tem.execute(
    `select to_char(b.bill_date, 'YYYY-MM-DD') as date,
            coalesce(b.bill_no, '') as document_no,
            b.vendor_bill_ref as vendor_ref,
            p.display_name as vendor_name,
            p.tax_id as vendor_tax_id,
            (b.total_amount - b.tax_amount)::text as base,
            b.tax_amount::text as vat,
            b.total_amount::text as total
     from orva_ap_bills b
     left join orva_parties p on p.id = b.vendor_party_id
     where b.deleted_at is null and b.status = 'posted' and b.tenant_id = ?::uuid
       and (?::uuid is null or b.organization_id = ?::uuid)
       and b.tax_amount > 0
       and to_char(b.bill_date, 'YYYY-MM') = ?
     union all
     -- expenses paid straight from cash/bank: the receipt is the document
     select to_char(j.journal_date, 'YYYY-MM-DD') as date,
            coalesce(j.metadata->>'documentNo', j.journal_no) as document_no,
            j.metadata->>'documentNo' as vendor_ref,
            j.metadata->>'payee' as vendor_name,
            j.metadata->>'payeeTaxId' as vendor_tax_id,
            (j.metadata->>'net')::numeric::text as base,
            (j.metadata->>'vat')::numeric::text as vat,
            ((j.metadata->>'net')::numeric + (j.metadata->>'vat')::numeric)::text as total
     from orva_gl_journals j
     where j.deleted_at is null and j.status = 'posted' and j.tenant_id = ?::uuid
       and (?::uuid is null or j.organization_id = ?::uuid)
       and j.metadata->>'source' = 'orva_finance.expense'
       and coalesce((j.metadata->>'vat')::numeric, 0) > 0
       and to_char(j.journal_date, 'YYYY-MM') = ?
     order by 1, 2`,
    [scope.tenantId, ...org(scope), month, scope.tenantId, ...org(scope), month],
  )) as VatPurchaseRow[]

  const sum = (rows: Array<{ base: string; vat: string }>) =>
    rows.reduce((acc, r) => ({ base: acc.base + Number(r.base), vat: acc.vat + Number(r.vat) }), { base: 0, vat: 0 })
  const out = sum(sales)
  const inp = sum(purchases)
  return {
    month, sales, purchases,
    summary: {
      outputBase: out.base.toFixed(2), outputVat: out.vat.toFixed(2),
      inputBase: inp.base.toFixed(2), inputVat: inp.vat.toFixed(2),
      netPayable: (out.vat - inp.vat).toFixed(2),
    },
  }
}

// ---------------------------------------------------------------- WHT ------

export type WhtByUsRow = {
  date: string; payment_no: string | null; cert_no: string | null; vendor_name: string | null
  vendor_tax_id: string | null; income_type: string | null; rate: string | null; base: string; wht: string
}
export type WhtFromUsRow = {
  date: string; receipt_no: string | null; invoice_no: string | null; customer_name: string | null
  rate: string | null; base: string; wht: string
}
export type WhtReport = {
  month: string
  withheldByUs: WhtByUsRow[]
  withheldFromUs: WhtFromUsRow[]
  summary: { payable: string; receivable: string }
}

export async function whtReport(tem: EntityManager, scope: Scope, month: string): Promise<WhtReport> {
  const withheldByUs = (await tem.execute(
    `select to_char(pm.payment_date, 'YYYY-MM-DD') as date,
            pm.payment_no, pm.wht_cert_no as cert_no,
            p.display_name as vendor_name, p.tax_id as vendor_tax_id,
            pm.wht_type as income_type, pm.wht_rate::text as rate,
            pm.total_amount::text as base, pm.wht_amount::text as wht
     from orva_ap_payments pm
     left join orva_parties p on p.id = pm.vendor_party_id
     where pm.deleted_at is null and pm.status = 'posted' and pm.tenant_id = ?::uuid
       and (?::uuid is null or pm.organization_id = ?::uuid)
       and pm.wht_amount > 0
       and to_char(pm.payment_date, 'YYYY-MM') = ?
     union all
     -- withholding taken on an expense paid straight from cash/bank
     select to_char(j.journal_date, 'YYYY-MM-DD') as date,
            j.journal_no as payment_no, null as cert_no,
            j.metadata->>'payee' as vendor_name, j.metadata->>'payeeTaxId' as vendor_tax_id,
            null as income_type, (j.metadata->>'whtRate') as rate,
            (j.metadata->>'net')::numeric::text as base, (j.metadata->>'wht')::numeric::text as wht
     from orva_gl_journals j
     where j.deleted_at is null and j.status = 'posted' and j.tenant_id = ?::uuid
       and (?::uuid is null or j.organization_id = ?::uuid)
       and j.metadata->>'source' = 'orva_finance.expense'
       and coalesce((j.metadata->>'wht')::numeric, 0) > 0
       and to_char(j.journal_date, 'YYYY-MM') = ?
     order by 1, 2`,
    [scope.tenantId, ...org(scope), month, scope.tenantId, ...org(scope), month],
  )) as WhtByUsRow[]

  const withheldFromUs = (await tem.execute(
    `select to_char(r.receipt_date, 'YYYY-MM-DD') as date,
            r.receipt_no,
            (select ip.invoice_number from orva_ar_receipt_allocations a
               join orva_ar_invoice_postings ip on ip.invoice_id = a.invoice_id
               where a.receipt_id = r.id and a.deleted_at is null limit 1) as invoice_no,
            (select coalesce(i.metadata->'customerSnapshot'->'customer'->>'displayName',
                             i.metadata->'customerSnapshot'->>'displayName')
               from orva_ar_receipt_allocations a
               join sales_invoices i on i.id = a.invoice_id
               where a.receipt_id = r.id and a.deleted_at is null limit 1) as customer_name,
            r.wht_rate::text as rate,
            r.total_amount::text as base, r.wht_amount::text as wht
     from orva_ar_receipts r
     where r.deleted_at is null and r.status = 'posted' and r.tenant_id = ?::uuid
       and (?::uuid is null or r.organization_id = ?::uuid)
       and r.wht_amount > 0
       and to_char(r.receipt_date, 'YYYY-MM') = ?
       and not exists (select 1 from orva_gl_journals rj
                        where rj.reversal_of_id = r.journal_id and rj.status = 'posted' and rj.deleted_at is null)
     order by r.receipt_date, r.receipt_no`,
    [scope.tenantId, ...org(scope), month],
  )) as WhtFromUsRow[]

  const total = (rows: Array<{ wht: string }>) => rows.reduce((s, r) => s + Number(r.wht), 0)
  return {
    month, withheldByUs, withheldFromUs,
    summary: { payable: total(withheldByUs).toFixed(2), receivable: total(withheldFromUs).toFixed(2) },
  }
}

// ---------------------------------------------------------- account sums ---

/**
 * Per-account debit/credit sums of posted lines. `from`/`to` bound the
 * journal date (either may be null); `excludeClosing` drops closing journals
 * (a P&L over a closed period would otherwise read zero).
 */
export async function accountSums(
  tem: EntityManager,
  scope: Scope,
  opts: { from?: string | null; to?: string | null; excludeClosing?: boolean; toExclusive?: string | null } = {},
): Promise<AccountSums[]> {
  const rows = (await tem.execute(
    `select a.id as "accountId", a.code, a.name, a.account_type as "accountType",
            coalesce(sum(x.debit), 0)::text as debit, coalesce(sum(x.credit), 0)::text as credit
     from orva_gl_accounts a
     left join (
       select l.account_id, l.debit, l.credit
       from orva_gl_journal_lines l
       join orva_gl_journals j on j.id = l.journal_id and j.status = 'posted' and j.deleted_at is null
       where l.deleted_at is null and l.tenant_id = ?::uuid
         and (?::uuid is null or j.organization_id = ?::uuid)
         ${opts.excludeClosing ? `and j.journal_kind <> 'closing'` : ''}
         and (?::date is null or j.journal_date >= ?::date)
         and (?::date is null or j.journal_date <= ?::date)
         and (?::date is null or j.journal_date < ?::date)
     ) x on x.account_id = a.id
     where a.tenant_id = ?::uuid and a.deleted_at is null
       and (?::uuid is null or a.organization_id = ?::uuid)
     group by a.id, a.code, a.name, a.account_type
     order by a.code`,
    [
      scope.tenantId, ...org(scope),
      opts.from ?? null, opts.from ?? null,
      opts.to ?? null, opts.to ?? null,
      opts.toExclusive ?? null, opts.toExclusive ?? null,
      scope.tenantId, ...org(scope),
    ],
  )) as AccountSums[]
  return rows
}

// ----------------------------------------------------------- journals ------

export type JournalLineRow = {
  journal_no: string | null; journal_date: string; journal_kind: string; memo: string | null
  line_no: number; account_code: string; account_name: string; description: string | null
  debit: string; credit: string
}

/** สมุดรายวันทั่วไป — every posted line of the month, in journal order. */
export async function journalLines(tem: EntityManager, scope: Scope, from: string, to: string): Promise<JournalLineRow[]> {
  return (await tem.execute(
    `select j.journal_no, to_char(j.journal_date, 'YYYY-MM-DD') as journal_date, j.journal_kind, j.memo,
            l.line_no, a.code as account_code, a.name as account_name, l.description,
            l.debit::text, l.credit::text
     from orva_gl_journal_lines l
     join orva_gl_journals j on j.id = l.journal_id and j.status = 'posted' and j.deleted_at is null
     join orva_gl_accounts a on a.id = l.account_id
     where l.deleted_at is null and l.tenant_id = ?::uuid
       and (?::uuid is null or j.organization_id = ?::uuid)
       and j.journal_date between ?::date and ?::date
     order by j.journal_date, j.journal_no, l.line_no`,
    [scope.tenantId, ...org(scope), from, to],
  )) as JournalLineRow[]
}

// -------------------------------------------------------- bookkeeping to-do -

export type BookkeepingStatus = {
  draftJournals: number
  unpostedInvoices: number
  unmatchedBankLines: number
  periodStatus: 'open' | 'closed' | 'missing'
}

/** What is still loose in the books for a month — the pre-flight before a pack goes out. */
export async function bookkeepingStatus(tem: EntityManager, scope: Scope, month: string, from: string, to: string): Promise<BookkeepingStatus> {
  const [drafts] = (await tem.execute(
    `select count(*)::int as n from orva_gl_journals
     where deleted_at is null and status = 'draft' and tenant_id = ?::uuid
       and (?::uuid is null or organization_id = ?::uuid)
       and journal_date between ?::date and ?::date`,
    [scope.tenantId, ...org(scope), from, to],
  )) as Array<{ n: number }>
  const [unposted] = (await tem.execute(
    `select count(*)::int as n from sales_invoices i
     where i.deleted_at is null and i.tenant_id = ?::uuid
       and (?::uuid is null or i.organization_id = ?::uuid)
       and coalesce(i.issue_date::date, i.created_at::date) between ?::date and ?::date
       and i.grand_total_gross_amount > 0
       and not exists (select 1 from orva_ar_invoice_postings ip where ip.invoice_id = i.id)`,
    [scope.tenantId, ...org(scope), from, to],
  )) as Array<{ n: number }>
  const [bank] = (await tem.execute(
    `select count(*)::int as n from orva_bank_statement_lines
     where deleted_at is null and status = 'unmatched' and tenant_id = ?::uuid
       and (?::uuid is null or organization_id = ?::uuid)
       and txn_date between ?::date and ?::date`,
    [scope.tenantId, ...org(scope), from, to],
  )) as Array<{ n: number }>
  const periods = (await tem.execute(
    `select status from orva_fiscal_periods
     where deleted_at is null and code = ? and tenant_id = ?::uuid
       and (?::uuid is null or organization_id = ?::uuid) limit 1`,
    [month, scope.tenantId, ...org(scope)],
  )) as Array<{ status: string }>
  return {
    draftJournals: drafts?.n ?? 0,
    unpostedInvoices: unposted?.n ?? 0,
    unmatchedBankLines: bank?.n ?? 0,
    periodStatus: periods[0]?.status === 'closed' ? 'closed' : periods[0] ? 'open' : 'missing',
  }
}

// ------------------------------------------------------ owner home queries --

export type OpenInvoiceRow = {
  id: string; invoice_number: string; customer_name: string | null; customer_entity_id: string | null; issue_date: string | null
  due_date: string | null; net: string; total: string; remaining: string; updated_at: string
}

/** Issued invoices not yet (fully) paid — money the owner is waiting for. */
export async function openInvoices(tem: EntityManager, scope: Scope): Promise<OpenInvoiceRow[]> {
  return (await tem.execute(
    `select i.id, i.invoice_number,
            coalesce(i.metadata->'customerSnapshot'->'customer'->>'displayName',
                     i.metadata->'customerSnapshot'->>'displayName',
                     (select ce.display_name from customer_entities ce where ce.id::text = i.metadata->>'customerEntityId')) as customer_name,
            i.metadata->>'customerEntityId' as customer_entity_id,
            to_char(i.issue_date, 'YYYY-MM-DD') as issue_date,
            to_char(i.due_date, 'YYYY-MM-DD') as due_date,
            i.grand_total_net_amount::text as net,
            i.grand_total_gross_amount::text as total,
            (i.grand_total_gross_amount - coalesce(i.paid_total_amount, 0))::text as remaining,
            i.updated_at::text as updated_at
     from sales_invoices i
     where i.deleted_at is null and i.tenant_id = ?::uuid
       and (?::uuid is null or i.organization_id = ?::uuid)
       and i.grand_total_gross_amount - coalesce(i.paid_total_amount, 0) > 0.005
       and coalesce(i.status, '') not in ('cancelled', 'void', 'draft')
     order by i.due_date nulls last, i.issue_date
     limit 50`,
    [scope.tenantId, ...org(scope)],
  )) as OpenInvoiceRow[]
}

export type ReceiptRow = { receipt_date: string; receipt_no: string | null; invoice_no: string | null; cash: string; wht: string; total: string }

/** Posted receipts in a month: cash that actually landed, and the WHT credit that came with it. */
export async function receiptsInMonth(tem: EntityManager, scope: Scope, from: string, to: string): Promise<ReceiptRow[]> {
  return (await tem.execute(
    `select to_char(r.receipt_date, 'YYYY-MM-DD') as receipt_date, r.receipt_no,
            (select ip.invoice_number from orva_ar_receipt_allocations a
               join orva_ar_invoice_postings ip on ip.invoice_id = a.invoice_id
               where a.receipt_id = r.id and a.deleted_at is null limit 1) as invoice_no,
            (r.total_amount - coalesce(r.wht_amount, 0))::text as cash,
            coalesce(r.wht_amount, 0)::text as wht,
            r.total_amount::text as total
     from orva_ar_receipts r
     where r.deleted_at is null and r.status = 'posted' and r.tenant_id = ?::uuid
       and (?::uuid is null or r.organization_id = ?::uuid)
       and r.receipt_date between ?::date and ?::date
       -- a receipt whose journal was reversed (ใบกลับรายการ) never happened for cash purposes
       and not exists (select 1 from orva_gl_journals rj
                        where rj.reversal_of_id = r.journal_id and rj.status = 'posted' and rj.deleted_at is null)
     order by r.receipt_date, r.receipt_no`,
    [scope.tenantId, ...org(scope), from, to],
  )) as ReceiptRow[]
}

/** Balance of every cash/bank account (codes 10xx by Orva's chart) as of today. */
export async function cashBalances(tem: EntityManager, scope: Scope): Promise<Array<{ code: string; name: string; balance: string }>> {
  return (await tem.execute(
    `select a.code, a.name, (coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0))::text as balance
     from orva_gl_accounts a
     left join orva_gl_journal_lines l on l.account_id = a.id and l.deleted_at is null
       and exists (select 1 from orva_gl_journals j where j.id = l.journal_id and j.status = 'posted' and j.deleted_at is null)
     where a.deleted_at is null and a.tenant_id = ?::uuid
       and (?::uuid is null or a.organization_id = ?::uuid)
       and a.account_type = 'asset' and a.code like '10%'
     group by a.id, a.code, a.name
     order by a.code`,
    [scope.tenantId, ...org(scope)],
  )) as Array<{ code: string; name: string; balance: string }>
}

export type PendingQuoteRow = {
  id: string; quote_number: string; customer_entity_id: string | null; status: string | null
  valid_until: string | null; total: string; invoiced: number
}

/**
 * Quotes the customer has not answered — sent, still valid or just expired,
 * no invoice yet. The customer name is encrypted at rest (customer_entities
 * and the quote snapshot), so callers resolve it through the decrypting
 * finder from `customer_entity_id`.
 */
export async function pendingQuotes(tem: EntityManager, scope: Scope): Promise<PendingQuoteRow[]> {
  return (await tem.execute(
    `select q.id, q.quote_number, q.customer_entity_id,
            q.status, to_char(q.valid_until, 'YYYY-MM-DD') as valid_until,
            q.grand_total_gross_amount::text as total,
            (select count(*)::int from sales_invoices i
               where i.deleted_at is null and i.metadata->>'quoteId' = q.id::text) as invoiced
     from sales_quotes q
     where q.deleted_at is null and q.tenant_id = ?::uuid
       and (?::uuid is null or q.organization_id = ?::uuid)
       and coalesce(q.status, '') not in ('accepted', 'rejected', 'declined', 'cancelled', 'converted', 'expired')
       and not exists (select 1 from sales_invoices i where i.deleted_at is null and i.metadata->>'quoteId' = q.id::text)
     order by q.valid_until nulls last, q.created_at desc
     limit 20`,
    [scope.tenantId, ...org(scope)],
  )) as PendingQuoteRow[]
}

export type TaxDocumentRow = { id: string; invoice_number: string; paid_date: string; customer_name: string | null; total: string }

/** Invoices paid in the month — each carries a ใบกำกับภาษี + ใบเสร็จรับเงิน the pack should include. */
export async function taxDocumentsInMonth(tem: EntityManager, scope: Scope, month: string): Promise<TaxDocumentRow[]> {
  return (await tem.execute(
    `select i.id, i.invoice_number, i.metadata->>'paidDate' as paid_date,
            coalesce(i.metadata->'customerSnapshot'->'customer'->>'displayName',
                     i.metadata->'customerSnapshot'->>'displayName') as customer_name,
            i.grand_total_gross_amount::text as total
     from sales_invoices i
     where i.deleted_at is null and i.tenant_id = ?::uuid
       and (?::uuid is null or i.organization_id = ?::uuid)
       and left(i.metadata->>'paidDate', 7) = ?
     order by i.metadata->>'paidDate', i.invoice_number`,
    [scope.tenantId, ...org(scope), month],
  )) as TaxDocumentRow[]
}

export type MonthPackRow = { id: string; month: string; status: string; file_name: string; file_size: number; sent_to: string | null; sent_at: string | null; created_at: string; summary: Record<string, unknown> | null }

export async function monthPackHistory(tem: EntityManager, scope: Scope, month?: string): Promise<MonthPackRow[]> {
  return (await tem.execute(
    `select id, month, status, file_name, file_size, sent_to, sent_at::text, created_at::text, summary
     from orva_month_packs
     where deleted_at is null and tenant_id = ?::uuid
       and (?::uuid is null or organization_id = ?::uuid)
       and (?::text is null or month = ?::text)
     order by created_at desc
     limit 24`,
    [scope.tenantId, ...org(scope), month ?? null, month ?? null],
  )) as MonthPackRow[]
}

export type BankLineRow = {
  account_code: string; account_name: string; txn_date: string; description: string | null
  reference: string | null; amount: string; status: string; journal_no: string | null
}

/** Imported bank statement lines of the month with their reconciliation state. */
export async function bankLinesInMonth(tem: EntityManager, scope: Scope, from: string, to: string): Promise<BankLineRow[]> {
  return (await tem.execute(
    `select a.code as account_code, a.name as account_name,
            to_char(s.txn_date, 'YYYY-MM-DD') as txn_date, s.description, s.reference,
            s.amount::text, s.status,
            (select j.journal_no from orva_gl_journal_lines l join orva_gl_journals j on j.id = l.journal_id
               where l.id = s.journal_line_id) as journal_no
     from orva_bank_statement_lines s
     join orva_gl_accounts a on a.id = s.account_id
     where s.deleted_at is null and s.tenant_id = ?::uuid
       and (?::uuid is null or s.organization_id = ?::uuid)
       and s.txn_date between ?::date and ?::date
     order by a.code, s.txn_date, s.created_at`,
    [scope.tenantId, ...org(scope), from, to],
  )) as BankLineRow[]
}

/** Seller identity for the pack's cover sheet — the directory organization's name. */
export async function organizationName(tem: EntityManager, scope: Scope): Promise<string | null> {
  if (!scope.organizationId) return null
  const rows = (await tem.execute(`select name from organizations where id = ?::uuid limit 1`, [scope.organizationId])) as Array<{ name: string }>
  return rows[0]?.name ?? null
}
