/**
 * Kaiser operating-model tool pack — "agents as staff" (spec
 * .ai/specs/2026-09-03-orva-for-kaiser-klowns-operating-model.md, phase C).
 *
 * Read tools answer the owner's four questions and prepare work; the three
 * mutation tools (record a receipt, send a payment reminder, send the month
 * pack) are `isMutation: true`, so the assistant runtime turns each call into
 * a pending action the owner approves on a preview card — the handler never
 * runs before that approval. Writes go through the same API routes the
 * screens use (`createAiApiOperationRunner`), so RBAC, optimistic locking
 * and the finance bridge behave exactly as in the UI.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { createAiApiOperationRunner, type AiToolExecutionContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner'
import type { AiToolDefinition, McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import { withTenantRls } from '@/lib/rls'
import { daysBetween, isoDate, monthBounds, previousMonth } from '../lib/homeOverview'
import { buildHomeOverview, resolveCustomerNames } from '../lib/homeOverviewData'
import { planMonthPack, thaiMonthName } from '../lib/monthPack'
import { buildQuoteDraft, paymentReminderText } from '../lib/quoteDraft'
import { monthPackHistory, openInvoices, organizationName, type Scope } from '../lib/reportQueries'
import { matchSlipToInvoices, parseThaiAmount, parseThaiDate } from '../lib/slipMatch'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { GlSettings } from '../data/entities'

function requireScope(ctx: McpToolContext): Scope & { tenantId: string } {
  if (!ctx.tenantId) throw new Error('Tenant context is required for orva_finance.* tools')
  return { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
}
const resolveEm = (ctx: McpToolContext) => ctx.container.resolve<EntityManager>('em')
const runner = (ctx: McpToolContext) => createAiApiOperationRunner(ctx as AiToolExecutionContext)
const money = (n: number | string) => Number(n).toFixed(2)

// ── orva_finance.get_home_overview ────────────────────────────────────────────

const homeOverviewInput = z.object({
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Override "today" (YYYY-MM-DD). Defaults to the current date.'),
}).passthrough()

export const getHomeOverviewTool: AiToolDefinition = {
  name: 'orva_finance.get_home_overview',
  displayName: 'วันนี้ต้องดูอะไร (four questions)',
  description:
    "The owner's daily overview in one call: money due in (open invoices with overdue days), money received this month and bank balances, tax filings coming up (ภ.ง.ด.3/53 by the 7th, ภ.พ.30 by the 15th, with amounts and whether the month pack already went to the accountant), and what is waiting (unanswered quotes, unposted invoices, draft journals, unmatched bank lines). Call this first for any 'สรุปวันนี้' / 'what should I look at' question.",
  inputSchema: homeOverviewInput,
  requiredFeatures: ['orva_finance.gl.view'],
  tags: ['read', 'orva_finance', 'home'],
  handler: async (rawInput, ctx) => {
    const scope = requireScope(ctx)
    const input = homeOverviewInput.parse(rawInput)
    const today = input.today ?? isoDate(new Date())
    const em = resolveEm(ctx)
    const data = await withTenantRls(em, scope.tenantId, (tem) => buildHomeOverview(tem, scope, today))
    return { ...data, href: '/backend' }
  },
}

// ── orva_finance.list_open_invoices ───────────────────────────────────────────

const listOpenInvoicesInput = z.object({
  onlyOverdue: z.boolean().optional().describe('Return only invoices past their due date.'),
}).passthrough()

export const listOpenInvoicesTool: AiToolDefinition = {
  name: 'orva_finance.list_open_invoices',
  displayName: 'Open (unpaid) invoices',
  description:
    'Unpaid customer invoices with net (pre-VAT), gross, remaining, due date, days overdue, customer and the record version needed by record_receipt. Use before matching a slip, drafting a reminder, or recording a receipt.',
  inputSchema: listOpenInvoicesInput,
  requiredFeatures: ['orva_finance.gl.view'],
  tags: ['read', 'orva_finance', 'ar'],
  handler: async (rawInput, ctx) => {
    const scope = requireScope(ctx)
    const input = listOpenInvoicesInput.parse(rawInput)
    const today = isoDate(new Date())
    const em = resolveEm(ctx)
    return withTenantRls(em, scope.tenantId, async (tem) => {
      const rows = await openInvoices(tem, scope)
      const names = await resolveCustomerNames(tem, scope, rows.filter((r) => !r.customer_name).map((r) => r.customer_entity_id))
      const items = rows.map((r) => ({
        invoiceId: r.id,
        invoiceNumber: r.invoice_number,
        customer: r.customer_name ?? (r.customer_entity_id ? names.get(r.customer_entity_id) ?? null : null),
        customerEntityId: r.customer_entity_id,
        issueDate: r.issue_date,
        dueDate: r.due_date,
        daysOverdue: r.due_date ? Math.max(0, daysBetween(r.due_date, today)) : 0,
        net: money(r.net),
        gross: money(r.total),
        remaining: money(r.remaining),
        updatedAt: r.updated_at,
        href: `/backend/sales/invoices/${r.id}`,
      }))
      return { asOf: today, items: input.onlyOverdue ? items.filter((i) => i.daysOverdue > 0) : items }
    })
  },
}

// ── orva_finance.match_slip ───────────────────────────────────────────────────

const matchSlipInput = z.object({
  amount: z.union([z.number(), z.string()]).describe('Transfer amount read from the slip, e.g. 24960 or "24,960.00 บาท".'),
  date: z.string().optional().describe('Transfer date as printed on the slip (Thai "31 ส.ค. 69", "31/08/2569", ISO...). Optional.'),
  reference: z.string().max(100).optional().describe('Bank reference / transaction id printed on the slip. Optional.'),
  payerName: z.string().max(200).optional().describe('Sender name on the slip, if legible. Optional.'),
}).passthrough()

export const matchSlipTool: AiToolDefinition = {
  name: 'orva_finance.match_slip',
  displayName: 'Match a transfer slip to open invoices',
  description:
    'Given the amount (and optionally date/reference) read from a bank-transfer slip, ranks the open invoices it can settle. Recognises the Thai pattern where the customer transfers gross minus 3% withholding tax on the pre-VAT amount (e.g. 24,960 settles a 25,680 invoice with 720 WHT). Returns ready-to-confirm receipt payloads for record_receipt.',
  inputSchema: matchSlipInput,
  requiredFeatures: ['orva_finance.gl.view'],
  tags: ['read', 'orva_finance', 'ar', 'slip'],
  handler: async (rawInput, ctx) => {
    const scope = requireScope(ctx)
    const input = matchSlipInput.parse(rawInput)
    const amount = typeof input.amount === 'number' ? input.amount : parseThaiAmount(input.amount)
    if (!amount) throw new Error(`Could not read an amount from "${String(input.amount)}"`)
    const paidDate = input.date ? parseThaiDate(input.date) : null
    const em = resolveEm(ctx)
    return withTenantRls(em, scope.tenantId, async (tem) => {
      const rows = await openInvoices(tem, scope)
      const names = await resolveCustomerNames(tem, scope, rows.filter((r) => !r.customer_name).map((r) => r.customer_entity_id))
      const candidates = matchSlipToInvoices(amount, rows.map((r) => ({
        id: r.id,
        number: r.invoice_number,
        customer: r.customer_name ?? (r.customer_entity_id ? names.get(r.customer_entity_id) ?? null : null),
        net: Number(r.net),
        gross: Number(r.total),
        remaining: Number(r.remaining),
        dueDate: r.due_date,
      })))
      return {
        slip: { amount: money(amount), date: paidDate ?? input.date ?? null, reference: input.reference ?? null, payerName: input.payerName ?? null },
        candidates: candidates.slice(0, 5).map((c) => ({
          ...c,
          proposedReceipt: {
            invoiceId: c.invoiceId,
            paidDate: paidDate ?? isoDate(new Date()),
            amountReceived: c.cashReceived,
            whtAmount: c.wht,
            note: [input.payerName ? `โอนจาก ${input.payerName}` : null, input.reference ? `อ้างอิง ${input.reference}` : null].filter(Boolean).join(' ') || undefined,
          },
        })),
        hint: candidates.length === 0
          ? 'No open invoice can absorb this amount — check whether the invoice was already paid or the slip belongs to another company.'
          : candidates[0].kind === 'full_less_wht'
            ? 'Top match is a full settlement net of withholding tax: ask the customer for the 50 ทวิ certificate.'
            : null,
      }
    })
  },
}

// ── orva_finance.record_receipt (mutation) ────────────────────────────────────

const recordReceiptInput = z.object({
  invoiceId: z.string().uuid(),
  paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Date the money arrived (YYYY-MM-DD).'),
  amountReceived: z.number().positive().describe('Cash that actually landed in the bank.'),
  whtAmount: z.number().min(0).default(0).describe('Withholding tax the customer deducted (0 when none).'),
  note: z.string().trim().max(500).optional().describe('Bank reference / payer, stored on the invoice and receipt.'),
}).strict()

type RecordReceiptInput = z.infer<typeof recordReceiptInput>

type PaymentContext = { invoiceNumber: string; gross: number; net: number; tax: number; outstanding: number; paidDate: string | null; dueDate: string | null; updatedAt: string | null }

async function loadPaymentContext(ctx: McpToolContext, invoiceId: string): Promise<PaymentContext> {
  const res = await runner(ctx).run<PaymentContext>({ method: 'GET', path: '/orva_documents/record-payment', query: { invoiceId } })
  if (!res.success || !res.data) throw new Error(res.error ?? `Invoice ${invoiceId} is not accessible`)
  return res.data
}

export const recordReceiptTool: AiToolDefinition<RecordReceiptInput> = {
  name: 'orva_finance.record_receipt',
  displayName: 'บันทึกรับชำระ (record a customer payment)',
  description:
    'Records a customer payment against an invoice exactly like the บันทึกรับชำระ dialog: marks the invoice paid on that date, books Dr bank / Dr WHT receivable / Cr AR through the finance bridge, and makes the tax invoice + receipt available. Requires owner approval (pending action). Use the payload from match_slip.',
  inputSchema: recordReceiptInput,
  requiredFeatures: ['orva_finance.ar.manage', 'sales.invoices.manage'],
  tags: ['write', 'orva_finance', 'ar', 'receipt'],
  isMutation: true,
  isDestructive: false,
  loadBeforeRecord: async (input, ctx) => {
    const before = await loadPaymentContext(ctx, input.invoiceId)
    const paidTotal = Math.round((input.amountReceived + input.whtAmount) * 100) / 100
    return {
      recordId: input.invoiceId,
      entityType: 'sales.invoice',
      recordVersion: before.updatedAt,
      before: { invoiceNumber: before.invoiceNumber, paidDate: before.paidDate, outstanding: before.outstanding, gross: before.gross },
      after: { invoiceNumber: before.invoiceNumber, paidDate: input.paidDate, outstanding: Math.max(0, Math.round((before.gross - paidTotal) * 100) / 100), gross: before.gross, amountReceived: input.amountReceived, whtAmount: input.whtAmount },
      display: { fieldLabels: { invoiceNumber: 'ใบแจ้งหนี้', paidDate: 'วันที่รับเงิน', outstanding: 'คงค้าง', gross: 'ยอดรวม', amountReceived: 'เงินเข้าบัญชี', whtAmount: 'หัก ณ ที่จ่าย' } },
    }
  },
  handler: async (rawInput, ctx) => {
    requireScope(ctx)
    const input = recordReceiptInput.parse(rawInput)
    const before = await loadPaymentContext(ctx, input.invoiceId)
    if (!before.updatedAt) throw new Error('Invoice version is unknown; open the invoice and record the payment there.')
    const res = await runner(ctx).run<{ id: string; paidDate: string; paidTotal: number; outstanding: number; accounting?: { ok: boolean; journalNo?: string; receiptNo?: string | null; reason?: string } }>({
      method: 'POST',
      path: '/orva_documents/record-payment',
      body: { ...input, updatedAt: before.updatedAt },
    })
    if (!res.success || !res.data) throw new Error(res.error ?? 'Recording the payment failed')
    return {
      recordId: input.invoiceId,
      commandName: 'orva_documents.record_payment',
      invoiceNumber: before.invoiceNumber,
      before: { paidDate: before.paidDate, outstanding: before.outstanding },
      after: { paidDate: res.data.paidDate, outstanding: res.data.outstanding, paidTotal: res.data.paidTotal },
      accounting: res.data.accounting ?? null,
      documents: {
        taxInvoice: `/backend/documents/preview?type=tax_invoice&documentId=${input.invoiceId}`,
        receipt: `/backend/documents/preview?type=receipt&documentId=${input.invoiceId}`,
      },
    }
  },
}

// ── orva_finance.draft_payment_reminder ───────────────────────────────────────

const draftReminderInput = z.object({
  invoiceId: z.string().uuid(),
}).passthrough()

export const draftPaymentReminderTool: AiToolDefinition = {
  name: 'orva_finance.draft_payment_reminder',
  displayName: 'ร่างข้อความเตือนชำระ',
  description:
    "Drafts a polite Thai payment reminder for one open invoice (amount, due date, days overdue, WHT note) and returns the customer's email on file so the owner can approve send_payment_reminder or paste the text into LINE.",
  inputSchema: draftReminderInput,
  requiredFeatures: ['orva_finance.gl.view'],
  tags: ['read', 'orva_finance', 'ar', 'reminder'],
  handler: async (rawInput, ctx) => {
    const scope = requireScope(ctx)
    const input = draftReminderInput.parse(rawInput)
    const today = isoDate(new Date())
    const em = resolveEm(ctx)
    return withTenantRls(em, scope.tenantId, async (tem) => {
      const row = (await openInvoices(tem, scope)).find((r) => r.id === input.invoiceId)
      if (!row) throw new Error('Invoice is not open (paid, cancelled or not accessible).')
      let customer = row.customer_name
      let email: string | null = null
      if (row.customer_entity_id) {
        const [entity] = await findWithDecryption(tem, CustomerEntity, { id: row.customer_entity_id }, {}, { tenantId: scope.tenantId, organizationId: scope.organizationId ?? undefined })
        customer = customer ?? (entity as { displayName?: string | null } | undefined)?.displayName ?? null
        email = (entity as { primaryEmail?: string | null } | undefined)?.primaryEmail ?? null
      }
      const company = (await organizationName(tem, scope)) ?? 'บริษัท'
      const daysOverdue = row.due_date ? Math.max(0, daysBetween(row.due_date, today)) : 0
      return {
        invoiceId: row.id,
        invoiceNumber: row.invoice_number,
        customer,
        customerEmail: email,
        remaining: money(row.remaining),
        dueDate: row.due_date,
        daysOverdue,
        text: paymentReminderText({ customer, invoiceNumber: row.invoice_number, amount: Number(row.remaining), dueDate: row.due_date, daysOverdue, companyName: company }),
      }
    })
  },
}

// ── orva_finance.send_payment_reminder (mutation) ─────────────────────────────

const sendReminderInput = z.object({
  invoiceId: z.string().uuid(),
  to: z.string().trim().email().describe("Customer email — normally `customerEmail` from draft_payment_reminder."),
  message: z.string().trim().min(1).max(2000).describe('The reminder text (from draft_payment_reminder, edited if the owner asked).'),
}).strict()

export const sendPaymentReminderTool: AiToolDefinition<z.infer<typeof sendReminderInput>> = {
  name: 'orva_finance.send_payment_reminder',
  displayName: 'ส่งเตือนชำระพร้อมใบแจ้งหนี้',
  description: 'Emails the customer the invoice PDF with the reminder text as the cover note, through the same document-send route as the UI. Requires owner approval (pending action).',
  inputSchema: sendReminderInput,
  requiredFeatures: ['orva_finance.ar.manage', 'orva_documents.view'],
  tags: ['write', 'orva_finance', 'ar', 'reminder', 'email'],
  isMutation: true,
  isDestructive: false,
  loadBeforeRecord: async (input) => ({
    recordId: input.invoiceId,
    entityType: 'sales.invoice',
    recordVersion: null,
    before: { to: null, message: null },
    after: { to: input.to, message: input.message },
    display: { fieldLabels: { to: 'ส่งถึง', message: 'ข้อความ' } },
  }),
  handler: async (rawInput, ctx) => {
    requireScope(ctx)
    const input = sendReminderInput.parse(rawInput)
    const res = await runner(ctx).run<{ ok: boolean; fileName: string; bytes: number }>({
      method: 'POST',
      path: '/orva_documents/send',
      body: { to: input.to, type: 'invoice', documentId: input.invoiceId, message: input.message },
    })
    if (!res.success || !res.data) throw new Error(res.error ?? 'Sending the reminder failed')
    return { recordId: input.invoiceId, commandName: 'orva_documents.send', sentTo: input.to, fileName: res.data.fileName }
  },
}

// ── orva_finance.get_month_pack_status ────────────────────────────────────────

const monthPackStatusInput = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional().describe('YYYY-MM. Defaults to last month.'),
}).passthrough()

export const getMonthPackStatusTool: AiToolDefinition = {
  name: 'orva_finance.get_month_pack_status',
  displayName: 'สถานะชุดปิดเดือน',
  description:
    'Pre-flight for the monthly hand-off to the accounting firm: figures the pack will carry (ภ.พ.30 net, ภ.ง.ด.3/53, P&L, cash), what is still loose (draft journals, unposted invoices, unmatched bank lines, open period), tax documents to attach, the accountant on file, and whether the pack was already sent.',
  inputSchema: monthPackStatusInput,
  requiredFeatures: ['orva_finance.gl.view'],
  tags: ['read', 'orva_finance', 'month-pack'],
  handler: async (rawInput, ctx) => {
    const scope = requireScope(ctx)
    const input = monthPackStatusInput.parse(rawInput)
    const month = input.month ?? previousMonth(isoDate(new Date()).slice(0, 7))
    const em = resolveEm(ctx)
    return withTenantRls(em, scope.tenantId, async (tem) => {
      const plan = await planMonthPack(tem, scope, month)
      const history = await monthPackHistory(tem, scope, month)
      const settings = scope.organizationId ? await tem.findOne(GlSettings, { tenantId: scope.tenantId, organizationId: scope.organizationId }) : null
      const sent = history.find((h) => h.status === 'sent')
      return {
        month,
        monthLabel: thaiMonthName(month),
        range: monthBounds(month),
        figures: plan.figures,
        checklist: plan.checklist,
        ready: plan.checklist.draftJournals === 0 && plan.checklist.unpostedInvoices === 0 && plan.checklist.unmatchedBankLines === 0,
        taxDocuments: plan.taxDocuments.map((d) => ({ invoiceNumber: d.invoice_number, paidDate: d.paid_date, customer: d.customer_name, total: money(d.total) })),
        accountant: { email: settings?.accountantEmail ?? null, name: settings?.accountantName ?? null },
        alreadySent: sent ? { at: sent.sent_at, to: sent.sent_to } : null,
        href: '/backend/reports/month-pack',
      }
    })
  },
}

// ── orva_finance.send_month_pack (mutation) ───────────────────────────────────

const sendMonthPackInput = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  to: z.string().trim().email().optional().describe('Override the accountant email on file for this send only.'),
  message: z.string().trim().max(2000).optional().describe('Extra note for the accountant.'),
  includePdf: z.boolean().optional().describe('Attach the tax-document PDFs (default true).'),
}).strict()

export const sendMonthPackTool: AiToolDefinition<z.infer<typeof sendMonthPackInput>> = {
  name: 'orva_finance.send_month_pack',
  displayName: 'ส่งชุดปิดเดือนให้สำนักงานบัญชี',
  description:
    'Builds the ชุดปิดเดือน zip (VAT/WHT registers, journal, ledger, trial balances, statements, bank reconciliation, tax-document PDFs) and emails it to the accounting firm on file. Requires owner approval (pending action). Check get_month_pack_status first and mention anything still loose.',
  inputSchema: sendMonthPackInput,
  requiredFeatures: ['orva_finance.gl.manage'],
  tags: ['write', 'orva_finance', 'month-pack', 'email'],
  isMutation: true,
  isDestructive: false,
  loadBeforeRecord: async (input, ctx) => {
    const scope = requireScope(ctx)
    const em = resolveEm(ctx)
    const settings = scope.organizationId ? await em.fork().findOne(GlSettings, { tenantId: scope.tenantId, organizationId: scope.organizationId }) : null
    return {
      recordId: input.month,
      entityType: 'orva_finance.month_pack',
      recordVersion: null,
      before: { month: input.month, to: settings?.accountantEmail ?? null, status: 'not sent' },
      after: { month: input.month, to: input.to ?? settings?.accountantEmail ?? null, status: 'sent', includePdf: input.includePdf !== false },
      display: { fieldLabels: { month: 'เดือน', to: 'ส่งถึง', status: 'สถานะ', includePdf: 'แนบ PDF เอกสารภาษี' } },
    }
  },
  handler: async (rawInput, ctx) => {
    requireScope(ctx)
    const input = sendMonthPackInput.parse(rawInput)
    const res = await runner(ctx).run<{ ok: true; sentTo: string; fileName: string; fileSize: number; pdfCount: number; delivered: boolean }>({
      method: 'POST',
      path: '/orva_finance/reports/month-pack/send',
      body: input,
    })
    if (!res.success || !res.data) throw new Error(res.error ?? 'Sending the month pack failed')
    return { recordId: input.month, commandName: 'orva_finance.month_pack.send', ...res.data, href: '/backend/reports/month-pack' }
  },
}

// ── orva_finance.draft_quote ──────────────────────────────────────────────────

const draftQuoteInput = z.object({
  customer: z.string().max(200).optional().describe('Customer name as the owner said it.'),
  lines: z.array(z.object({
    description: z.string().min(1).max(300),
    quantity: z.number().positive().default(1),
    unitPrice: z.number().min(0),
  })).min(1).max(30),
  installments: z.array(z.object({ label: z.string().max(100), percent: z.number().positive().max(100) })).max(10).optional()
    .describe('Payment schedule as percentages summing to 100, e.g. 30% start / 40% delivery / 30% acceptance. Omit for one payment.'),
  pricesIncludeVat: z.boolean().optional().describe('True when the owner quoted VAT-inclusive prices.'),
}).strict()

export const draftQuoteTool: AiToolDefinition<z.infer<typeof draftQuoteInput>> = {
  name: 'orva_finance.draft_quote',
  displayName: 'ร่างใบเสนอราคา',
  description:
    'Turns a brief (customer, lines, installment split) into a complete quotation draft: line amounts, 7% VAT, gross, the 3% withholding the customer will deduct, the expected transfer per installment, and a link to the create screen. Read-only — the owner creates the quote from the draft.',
  inputSchema: draftQuoteInput,
  requiredFeatures: ['orva_finance.gl.view'],
  tags: ['read', 'orva_finance', 'sales', 'quote'],
  handler: async (rawInput) => {
    const input = draftQuoteInput.parse(rawInput)
    const draft = buildQuoteDraft(input.lines, { installments: input.installments, pricesIncludeVat: input.pricesIncludeVat })
    return { customer: input.customer ?? null, ...draft, createHref: '/backend/sales/documents/create' }
  },
}

export const kaiserPack: AiToolDefinition[] = [
  getHomeOverviewTool,
  listOpenInvoicesTool,
  matchSlipTool,
  recordReceiptTool as AiToolDefinition,
  draftPaymentReminderTool,
  sendPaymentReminderTool as AiToolDefinition,
  getMonthPackStatusTool,
  sendMonthPackTool as AiToolDefinition,
  draftQuoteTool as AiToolDefinition,
]
