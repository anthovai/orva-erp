import type { EntityManager } from '@mikro-orm/postgresql'

/**
 * What a signed-in customer may see of their own paperwork.
 *
 * The scope is always the customer entity on their session — never an id from
 * the request — so one customer cannot name another's quote. Both reads are
 * additionally pinned to the tenant and organisation, which is belt and
 * braces on top of the row-level policies.
 *
 * Invoices carry their customer in `metadata.customerEntityId`, written by
 * `issue-invoice` at the moment the งวด is minted: upstream's invoice has no
 * customer column of its own, and that metadata is not encrypted (the quote's
 * snapshot is, the invoice's context is not), so it can be filtered in SQL.
 */

export type PortalScope = { tenantId: string; organizationId: string }

export type PortalQuote = {
  id: string
  number: string
  issueDate: string | null
  validUntil: string | null
  total: number
  currency: string
  /** True once any งวด has been issued from it — the quote is being billed. */
  billed: boolean
}

export type PortalInvoice = {
  id: string
  number: string
  issueDate: string | null
  dueDate: string | null
  paidDate: string | null
  total: number
  outstanding: number
  currency: string
  /** Which quote this งวด came from, when it came from one. */
  quoteNumber: string | null
  installmentNo: number | null
}

export type PortalDocuments = {
  quotes: PortalQuote[]
  invoices: PortalInvoice[]
  summary: { outstanding: number; unpaidCount: number; currency: string }
}

type QuoteRow = { id: string; quote_number: string; issue_date: string | null; valid_until: string | null; total: string; currency_code: string | null; billed: number }
type InvoiceRow = {
  id: string; invoice_number: string; issue_date: string | null; due_date: string | null; paid_date: string | null
  total: string; outstanding: string; currency_code: string | null; quote_number: string | null; installment_no: number | null
}

const num = (value: string | number | null | undefined): number => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0
}

export async function loadPortalDocuments(
  tem: EntityManager,
  scope: PortalScope,
  customerEntityId: string,
): Promise<PortalDocuments> {
  const quoteRows = (await tem.execute(
    `select q.id::text, q.quote_number,
            to_char(coalesce(q.placed_at, q.created_at), 'YYYY-MM-DD') as issue_date,
            to_char(q.valid_until, 'YYYY-MM-DD') as valid_until,
            q.grand_total_gross_amount::text as total, q.currency_code,
            (select count(*)::int from sales_invoices i
              where i.deleted_at is null and i.tenant_id = q.tenant_id
                and i.metadata->>'quoteId' = q.id::text) as billed
     from sales_quotes q
     where q.deleted_at is null and q.tenant_id = ?::uuid and q.organization_id = ?::uuid
       and q.customer_entity_id = ?::uuid
     order by coalesce(q.placed_at, q.created_at) desc
     limit 100`,
    [scope.tenantId, scope.organizationId, customerEntityId],
  )) as QuoteRow[]

  const invoiceRows = (await tem.execute(
    `select i.id::text, i.invoice_number,
            to_char(i.issue_date, 'YYYY-MM-DD') as issue_date,
            to_char(i.due_date, 'YYYY-MM-DD') as due_date,
            i.metadata->>'paidDate' as paid_date,
            i.grand_total_gross_amount::text as total,
            i.outstanding_amount::text as outstanding,
            i.currency_code,
            i.metadata->>'quoteNumber' as quote_number,
            (i.metadata->>'installmentNo')::int as installment_no
     from sales_invoices i
     where i.deleted_at is null and i.tenant_id = ?::uuid and i.organization_id = ?::uuid
       and i.metadata->>'customerEntityId' = ?
     order by i.issue_date desc nulls last, i.created_at desc
     limit 200`,
    [scope.tenantId, scope.organizationId, customerEntityId],
  )) as InvoiceRow[]

  const invoices = invoiceRows.map((row) => ({
    id: row.id,
    number: row.invoice_number,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    paidDate: row.paid_date,
    total: num(row.total),
    outstanding: num(row.outstanding),
    currency: row.currency_code ?? 'THB',
    quoteNumber: row.quote_number,
    installmentNo: row.installment_no == null ? null : Number(row.installment_no),
  }))

  const unpaid = invoices.filter((invoice) => invoice.outstanding > 0)
  return {
    quotes: quoteRows.map((row) => ({
      id: row.id,
      number: row.quote_number,
      issueDate: row.issue_date,
      validUntil: row.valid_until,
      total: num(row.total),
      currency: row.currency_code ?? 'THB',
      billed: Number(row.billed) > 0,
    })),
    invoices,
    summary: {
      outstanding: Math.round(unpaid.reduce((sum, invoice) => sum + invoice.outstanding, 0) * 100) / 100,
      unpaidCount: unpaid.length,
      currency: invoices[0]?.currency ?? quoteRows[0]?.currency_code ?? 'THB',
    },
  }
}

/**
 * Whether one document belongs to this customer. Asked before a document is
 * rendered for them, so a guessed id gets the same answer as one that does
 * not exist.
 */
export async function customerOwnsDocument(
  tem: EntityManager,
  scope: PortalScope,
  customerEntityId: string,
  documentId: string,
): Promise<'quote' | 'invoice' | null> {
  const rows = (await tem.execute(
    `select 'quote' as kind from sales_quotes
      where id = ?::uuid and deleted_at is null and tenant_id = ?::uuid and organization_id = ?::uuid
        and customer_entity_id = ?::uuid
     union all
     select 'invoice' as kind from sales_invoices
      where id = ?::uuid and deleted_at is null and tenant_id = ?::uuid and organization_id = ?::uuid
        and metadata->>'customerEntityId' = ?
     limit 1`,
    [
      documentId, scope.tenantId, scope.organizationId, customerEntityId,
      documentId, scope.tenantId, scope.organizationId, customerEntityId,
    ],
  )) as Array<{ kind: 'quote' | 'invoice' }>
  return rows[0]?.kind ?? null
}
