import type { EntityManager } from '@mikro-orm/postgresql'
import { withTenantRls } from '@/lib/rls'
import {
  ArInvoicePosting,
  ArReceipt,
  ArReceiptAllocation,
  ArSettings,
  FiscalPeriod,
  GlJournal,
  GlJournalLine,
} from '../data/entities'
import { buildArJournalLines, buildReceiptJournalLines } from './ar'
import { allocateJournalNo, checkPostable } from './posting'

/**
 * The documents → ledger bridge. orva_documents issues invoices and records
 * payments; without this the books never heard about either. Exposed through
 * DI (`orvaFinanceBridge`) so the documents module depends on it OPTIONALLY —
 * an installation without finance still issues documents.
 *
 * Both operations are best-effort from the caller's point of view: they
 * return a result or a reason, never throw past the boundary, and the
 * document operation that triggered them has already been committed.
 */

export type BridgeScope = { tenantId: string; organizationId: string; userId: string | null }

export type BridgeResult =
  | { ok: true; journalNo: string; receiptNo?: string | null }
  | { ok: false; reason: string }

type InvoiceRow = {
  id: string
  organization_id: string
  invoice_number: string
  currency_code: string
  grand_total_gross_amount: string
  tax_total_amount: string
  issue_date: string | null
}

async function periodCovering(tem: EntityManager, scope: BridgeScope, date: string) {
  return tem.findOne(FiscalPeriod, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
    status: 'open',
    startsOn: { $lte: date },
    endsOn: { $gte: date },
  })
}

/** Books a sales invoice into AR (Dr AR / Cr revenue + VAT out). Idempotent per invoice. */
export async function postInvoiceToLedger(
  em: EntityManager,
  scope: BridgeScope,
  args: { invoiceId: string; date: string },
): Promise<BridgeResult> {
  try {
    return await withTenantRls(em, scope.tenantId, async (tem): Promise<BridgeResult> => {
      const already = await tem.findOne(ArInvoicePosting, { invoiceId: args.invoiceId, tenantId: scope.tenantId })
      if (already) return { ok: true, journalNo: 'already-posted' }
      const rows = (await tem.execute(
        `select id, organization_id, invoice_number, currency_code,
                grand_total_gross_amount::text, tax_total_amount::text,
                to_char(issue_date, 'YYYY-MM-DD') as issue_date
         from sales_invoices where id = ?::uuid and tenant_id = ?::uuid and deleted_at is null`,
        [args.invoiceId, scope.tenantId],
      )) as InvoiceRow[]
      const invoice = rows[0]
      if (!invoice) return { ok: false, reason: 'invoice not found' }
      if (Number(invoice.grand_total_gross_amount) <= 0) return { ok: false, reason: 'zero-total invoice' }
      const settings = await tem.findOne(ArSettings, { tenantId: scope.tenantId, organizationId: invoice.organization_id })
      if (!settings) return { ok: false, reason: 'AR accounts are not configured' }
      const period = await periodCovering(tem, scope, args.date)
      if (!period) return { ok: false, reason: `no open fiscal period covers ${args.date}` }

      const lines = buildArJournalLines(
        invoice.grand_total_gross_amount, invoice.tax_total_amount,
        settings.arAccountId, settings.revenueAccountId, settings.taxAccountId,
      )
      const verdict = checkPostable({
        journalStatus: 'draft', journalDate: args.date, lines,
        period: { status: period.status, startsOn: String(period.startsOn), endsOn: String(period.endsOn) },
      })
      if (!verdict.ok) return { ok: false, reason: verdict.reason }

      const now = new Date()
      const total = Number(invoice.grand_total_gross_amount).toFixed(4)
      const journalNo = await allocateJournalNo(tem, scope.tenantId, invoice.organization_id)
      const journal = tem.create(GlJournal, {
        tenantId: scope.tenantId, organizationId: invoice.organization_id, journalNo,
        status: 'draft', journalKind: 'standard', periodId: period.id, journalDate: args.date,
        currencyCode: invoice.currency_code, memo: `AR ${invoice.invoice_number}`,
        totalDebit: total, totalCredit: total, createdBy: scope.userId, createdAt: now, updatedAt: now,
      })
      tem.persist(journal)
      await tem.flush()
      lines.forEach((draft, index) => {
        tem.persist(tem.create(GlJournalLine, {
          tenantId: scope.tenantId, organizationId: invoice.organization_id, journalId: journal.id,
          lineNo: index + 1, accountId: draft.accountId, partyId: null,
          debit: draft.debit, credit: draft.credit,
          description: `${draft.description} — ${invoice.invoice_number}`, createdAt: now, updatedAt: now,
        }))
      })
      await tem.flush()
      journal.status = 'posted'
      journal.postedAt = now
      journal.postedBy = scope.userId
      tem.persist(tem.create(ArInvoicePosting, {
        tenantId: scope.tenantId, organizationId: invoice.organization_id,
        invoiceId: invoice.id, invoiceNumber: invoice.invoice_number, journalId: journal.id,
        amount: total, postedBy: scope.userId, createdAt: now,
      }))
      await tem.flush()
      return { ok: true, journalNo }
    })
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Books a customer payment against a posted invoice: Dr bank (cash received),
 * Dr WHT receivable (what the customer withheld), Cr AR (settled amount).
 * Uses the AR default bank account; the invoice is posted first if needed.
 */
export async function recordReceiptForInvoice(
  em: EntityManager,
  scope: BridgeScope,
  args: { invoiceId: string; date: string; cashReceived: number; wht: number; note?: string | null },
): Promise<BridgeResult> {
  const settled = Math.round((args.cashReceived + args.wht) * 100) / 100
  if (!(settled > 0)) return { ok: false, reason: 'nothing to settle' }
  try {
    return await withTenantRls(em, scope.tenantId, async (tem): Promise<BridgeResult> => {
      const posting = await tem.findOne(ArInvoicePosting, { invoiceId: args.invoiceId, tenantId: scope.tenantId })
      if (!posting) return { ok: false, reason: 'invoice is not posted to the ledger' }
      const settings = await tem.findOne(ArSettings, { tenantId: scope.tenantId, organizationId: posting.organizationId })
      if (!settings) return { ok: false, reason: 'AR accounts are not configured' }
      if (!settings.defaultCashAccountId) return { ok: false, reason: 'AR default bank account is not configured' }
      if (args.wht > 0 && !settings.whtReceivableAccountId) return { ok: false, reason: 'WHT receivable account is not configured' }
      const period = await periodCovering(tem, scope, args.date)
      if (!period) return { ok: false, reason: `no open fiscal period covers ${args.date}` }

      // never settle more than what is still open on the invoice
      const received = (await tem.execute(
        `select coalesce(sum(a.amount), 0) as received
         from orva_ar_receipt_allocations a
         join orva_ar_receipts r on r.id = a.receipt_id and r.status = 'posted' and r.deleted_at is null
         where a.invoice_id = ?::uuid and a.tenant_id = ?::uuid and a.deleted_at is null`,
        [args.invoiceId, scope.tenantId],
      )) as Array<{ received: string | number }>
      const remaining = Number(posting.amount) - Number(received[0]?.received ?? 0)
      if (settled > remaining + 0.005) return { ok: false, reason: `settlement ${settled.toFixed(2)} exceeds remaining ${remaining.toFixed(2)}` }

      const lines = buildReceiptJournalLines(
        settled, settings.defaultCashAccountId, settings.arAccountId, args.wht, settings.whtReceivableAccountId,
      )
      const verdict = checkPostable({
        journalStatus: 'draft', journalDate: args.date, lines,
        period: { status: period.status, startsOn: String(period.startsOn), endsOn: String(period.endsOn) },
      })
      if (!verdict.ok) return { ok: false, reason: verdict.reason }

      const now = new Date()
      const seq = (await tem.execute(
        `insert into orva_gl_sequences as s (tenant_id, organization_id, kind, next_value)
         values (?, ?, 'ar_receipt', 2)
         on conflict (tenant_id, organization_id, kind) do update set next_value = s.next_value + 1
         returning next_value - 1 as seq`,
        [scope.tenantId, posting.organizationId],
      )) as Array<{ seq: string | number }>
      const receiptNo = `RCT-${String(Number(seq[0]?.seq ?? 0)).padStart(6, '0')}`
      const totalStr = settled.toFixed(4)
      const receipt = tem.create(ArReceipt, {
        tenantId: scope.tenantId, organizationId: posting.organizationId, receiptNo, status: 'draft',
        customerPartyId: null, cashAccountId: settings.defaultCashAccountId, periodId: period.id,
        receiptDate: args.date, currencyCode: 'THB',
        memo: args.note?.trim() || `รับชำระ ${posting.invoiceNumber}`,
        totalAmount: totalStr, whtAmount: args.wht.toFixed(4), whtRate: null,
        sourceInvoiceId: args.invoiceId, createdBy: scope.userId, createdAt: now, updatedAt: now,
      })
      tem.persist(receipt)
      await tem.flush()
      tem.persist(tem.create(ArReceiptAllocation, {
        tenantId: scope.tenantId, organizationId: posting.organizationId, receiptId: receipt.id,
        invoiceId: args.invoiceId, amount: totalStr, createdAt: now, updatedAt: now,
      }))
      const journalNo = await allocateJournalNo(tem, scope.tenantId, posting.organizationId)
      const journal = tem.create(GlJournal, {
        tenantId: scope.tenantId, organizationId: posting.organizationId, journalNo,
        status: 'draft', journalKind: 'standard', periodId: period.id, journalDate: args.date,
        currencyCode: 'THB', memo: `AR receipt ${receiptNo} — ${posting.invoiceNumber}`,
        totalDebit: totalStr, totalCredit: totalStr, createdBy: scope.userId, createdAt: now, updatedAt: now,
      })
      tem.persist(journal)
      await tem.flush()
      lines.forEach((draft, index) => {
        tem.persist(tem.create(GlJournalLine, {
          tenantId: scope.tenantId, organizationId: posting.organizationId, journalId: journal.id,
          lineNo: index + 1, accountId: draft.accountId, partyId: null,
          debit: draft.debit, credit: draft.credit, description: draft.description, createdAt: now, updatedAt: now,
        }))
      })
      await tem.flush()
      journal.status = 'posted'
      journal.postedAt = now
      journal.postedBy = scope.userId
      receipt.status = 'posted'
      receipt.journalId = journal.id
      receipt.postedAt = now
      receipt.postedBy = scope.userId
      await tem.flush()
      return { ok: true, journalNo, receiptNo }
    })
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

export type OrvaFinanceBridge = {
  postInvoice: (scope: BridgeScope, args: { invoiceId: string; date: string }) => Promise<BridgeResult>
  recordReceipt: (
    scope: BridgeScope,
    args: { invoiceId: string; date: string; cashReceived: number; wht: number; note?: string | null },
  ) => Promise<BridgeResult>
}

export function createOrvaFinanceBridge({ em }: { em: EntityManager }): OrvaFinanceBridge {
  return {
    postInvoice: (scope, args) => postInvoiceToLedger(em, scope, args),
    recordReceipt: (scope, args) => recordReceiptForInvoice(em, scope, args),
  }
}
