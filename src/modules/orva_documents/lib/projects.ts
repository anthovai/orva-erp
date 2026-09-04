import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesQuote } from '@open-mercato/core/modules/sales/data/entities'
import { jsonRecord, snapshotName } from './source'

/**
 * โปรเจกต์ = ใบเสนอราคา. Kaiser Klowns sells software projects billed in
 * งวด (installments) issued from the quote, so the quote IS the project and
 * its billing progress is the project's progress. This reads the quote list
 * (decryption-aware, like lib/source.ts) and aggregates the invoices each
 * quote has issued via the `metadata->>'quoteId'` link that api/issue-invoice
 * writes — the same scalar tenant-filtered seam this module already uses on
 * sales tables; no cross-module ORM relation.
 */

export type ProjectStatus = 'not_started' | 'billing' | 'billed' | 'complete'

export type ProjectProgress = {
  status: ProjectStatus
  /** % of the quote total already invoiced (0–100, one decimal). */
  billedPct: number
  /** % of the quote total already paid. */
  paidPct: number
  /** quote total − invoiced so far (the งวด still to issue). */
  remainingToBill: number
  /** invoiced − paid (outstanding on issued invoices). */
  remainingToCollect: number
}

/** Half-a-satang tolerance so rounding on the last งวด still reads as complete. */
const EPS = 0.005

export function projectProgress(args: { quoteTotal: number; billed: number; paid: number }): ProjectProgress {
  const total = Math.max(0, args.quoteTotal)
  const billed = Math.max(0, args.billed)
  const paid = Math.max(0, args.paid)
  const pct = (value: number) =>
    total > 0 ? Math.min(100, Math.round((value / total) * 1000) / 10) : 0
  let status: ProjectStatus = 'billing'
  if (billed <= EPS) status = 'not_started'
  else if (total > 0 && paid + EPS >= total) status = 'complete'
  else if (total > 0 && billed + EPS >= total) status = 'billed'
  return {
    status,
    billedPct: pct(billed),
    paidPct: pct(paid),
    remainingToBill: Math.max(0, Math.round((total - billed) * 100) / 100),
    remainingToCollect: Math.max(0, Math.round((billed - paid) * 100) / 100),
  }
}

export type ProjectRow = ProjectProgress & {
  quoteId: string
  quoteNumber: string
  customerName: string | null
  currencyCode: string
  issueDate: string | null
  quoteStatus: string | null
  quoteTotal: number
  /** invoices issued from this quote */
  installments: number
  unpaidInstallments: number
  billed: number
  paid: number
  lastInvoiceDate: string | null
}

type InvoiceAggregate = {
  quote_id: string
  installments: number
  unpaid: number
  billed: string
  paid: string
  last_issue: string | null
}

const isoDate = (value: Date | string | null | undefined): string | null => {
  if (!value) return null
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

export async function listProjects(
  tem: EntityManager,
  scope: { tenantId: string; organizationId: string | null },
): Promise<ProjectRow[]> {
  const quotes = await findWithDecryption(
    tem, SalesQuote,
    {
      tenantId: scope.tenantId,
      deletedAt: null,
      ...(scope.organizationId ? { organizationId: scope.organizationId } : {}),
    },
    { orderBy: { createdAt: 'desc' }, limit: 200 },
    { tenantId: scope.tenantId },
  )
  if (!quotes.length) return []

  // paidDate in metadata is what record-payment stamps on full settlement.
  const aggregates = (await tem.execute(
    `select metadata->>'quoteId' as quote_id,
            count(*)::int as installments,
            (count(*) filter (where metadata->>'paidDate' is null))::int as unpaid,
            coalesce(sum(grand_total_gross_amount), 0)::text as billed,
            coalesce(sum(case when metadata->>'paidDate' is not null then grand_total_gross_amount else 0 end), 0)::text as paid,
            to_char(max(issue_date), 'YYYY-MM-DD') as last_issue
     from sales_invoices
     where deleted_at is null and tenant_id = ?::uuid and metadata->>'quoteId' is not null
     group by 1`,
    [scope.tenantId],
  )) as InvoiceAggregate[]
  const byQuote = new Map(aggregates.map((row) => [row.quote_id, row]))

  return quotes.map((quote) => {
    const agg = byQuote.get(quote.id)
    const quoteTotal = Number(quote.grandTotalGrossAmount ?? 0)
    const billed = Number(agg?.billed ?? 0)
    const paid = Number(agg?.paid ?? 0)
    return {
      quoteId: quote.id,
      quoteNumber: quote.quoteNumber,
      customerName: snapshotName(jsonRecord(quote.customerSnapshot)),
      currencyCode: quote.currencyCode,
      issueDate: isoDate(quote.placedAt ?? quote.createdAt),
      quoteStatus: (quote as { status?: string | null }).status ?? null,
      quoteTotal,
      installments: agg?.installments ?? 0,
      unpaidInstallments: agg?.unpaid ?? 0,
      billed,
      paid,
      lastInvoiceDate: agg?.last_issue ?? null,
      ...projectProgress({ quoteTotal, billed, paid }),
    }
  })
}
