/**
 * AI tool pack for @orva/finance — read-only reporting tools for the
 * Orva Finance Assistant (see ai-agents.ts).
 *
 * Every tool is tenant + organization scoped, runs its reads inside
 * withTenantRls (the database enforces isolation underneath the app), and
 * returns bounded, serializable results. Mutations are deliberately not
 * exposed in v1 — posting/paying stays in the backoffice UI.
 *
 * The tool shape mirrors the customers module's local-definition pattern
 * (a strict subset of AiToolDefinition) so the module compiles without
 * importing @open-mercato/ai-assistant.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { buildBalanceSheet, buildProfitAndLoss, type AccountSums } from './lib/statements'
import { buildAging, type AgingItemInput } from './lib/aging'

export interface OrvaFinanceToolContext {
  tenantId: string | null
  organizationId: string | null
  userId: string | null
  container: AwilixContainer
  userFeatures: string[]
  isSuperAdmin: boolean
}

export interface OrvaFinanceAiToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string
  displayName?: string
  description: string
  inputSchema: z.ZodType<TInput>
  requiredFeatures?: string[]
  tags?: string[]
  isMutation?: boolean
  maxCallsPerTurn?: number
  handler: (input: TInput, context: OrvaFinanceToolContext) => Promise<TOutput>
}

function requireScope(ctx: OrvaFinanceToolContext): { tenantId: string; organizationId: string | null } {
  if (!ctx.tenantId) throw new Error('Tenant context is required for orva_finance.* tools')
  return { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
}

function resolveEm(ctx: OrvaFinanceToolContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em')
}

// ── orva_finance.list_accounts ──────────────────────────────────────────────

const listAccountsInput = z.object({
  q: z.string().max(100).optional().describe('Filter by account code or name (case-insensitive substring).'),
  accountType: z.enum(['asset', 'liability', 'equity', 'income', 'expense']).optional(),
}).passthrough()

const listAccountsTool: OrvaFinanceAiToolDefinition = {
  name: 'orva_finance.list_accounts',
  displayName: 'List GL accounts',
  description: 'List chart-of-accounts entries (code, name, type, active flag), optionally filtered by text or account type.',
  inputSchema: listAccountsInput,
  requiredFeatures: ['orva_finance.gl.view'],
  tags: ['read', 'orva_finance'],
  handler: async (rawInput, ctx) => {
    const { tenantId, organizationId } = requireScope(ctx)
    const input = listAccountsInput.parse(rawInput)
    const em = resolveEm(ctx)
    const rows = await withTenantRls(em, tenantId, async (tem) =>
      (await tem.execute(
        `select id, code, name, account_type, is_active
         from orva_gl_accounts
         where deleted_at is null
           and tenant_id = ?::uuid
           and (?::uuid is null or organization_id = ?::uuid)
           and (?::text is null or code ilike '%' || ?::text || '%' or name ilike '%' || ?::text || '%')
           and (?::text is null or account_type = ?::text)
         order by code
         limit 200`,
        [
          tenantId,
          organizationId ?? null, organizationId ?? null,
          input.q ?? null, input.q ?? null, input.q ?? null,
          input.accountType ?? null, input.accountType ?? null,
        ],
      )) as Array<Record<string, unknown>>,
    )
    return {
      accounts: rows.map((row) => ({
        id: String(row.id),
        code: String(row.code),
        name: String(row.name),
        accountType: String(row.account_type),
        isActive: Boolean(row.is_active),
      })),
    }
  },
}

// ── orva_finance.list_journals ──────────────────────────────────────────────

const listJournalsInput = z.object({
  status: z.enum(['draft', 'posted']).optional(),
  limit: z.number().int().min(1).max(50).optional().describe('Max rows, default 20.'),
}).passthrough()

const listJournalsTool: OrvaFinanceAiToolDefinition = {
  name: 'orva_finance.list_journals',
  displayName: 'List GL journals',
  description: 'List recent GL journals (number, date, status, kind, memo, total debit) newest first, optionally filtered by status.',
  inputSchema: listJournalsInput,
  requiredFeatures: ['orva_finance.gl.view'],
  tags: ['read', 'orva_finance'],
  handler: async (rawInput, ctx) => {
    const { tenantId, organizationId } = requireScope(ctx)
    const input = listJournalsInput.parse(rawInput)
    const em = resolveEm(ctx)
    const rows = await withTenantRls(em, tenantId, async (tem) =>
      (await tem.execute(
        `select j.id, j.journal_no, to_char(j.journal_date, 'YYYY-MM-DD') as journal_date,
                j.status, j.journal_kind, j.memo,
                coalesce((select sum(l.debit) from orva_gl_journal_lines l
                          where l.journal_id = j.id and l.deleted_at is null), 0)::text as total_debit
         from orva_gl_journals j
         where j.deleted_at is null
           and j.tenant_id = ?::uuid
           and (?::uuid is null or j.organization_id = ?::uuid)
           and (?::text is null or j.status = ?::text)
         order by j.journal_date desc, j.created_at desc
         limit ?`,
        [
          tenantId,
          organizationId ?? null, organizationId ?? null,
          input.status ?? null, input.status ?? null,
          input.limit ?? 20,
        ],
      )) as Array<Record<string, unknown>>,
    )
    return {
      journals: rows.map((row) => ({
        id: String(row.id),
        journalNo: (row.journal_no as string | null) ?? null,
        journalDate: String(row.journal_date),
        status: String(row.status),
        journalKind: String(row.journal_kind),
        memo: (row.memo as string | null) ?? null,
        totalDebit: String(row.total_debit),
        href: `/backend/gl/journals`,
      })),
    }
  },
}

// ── orva_finance.get_trial_balance ──────────────────────────────────────────

const trialBalanceInput = z.object({
  periodId: z.string().uuid().optional().describe('Restrict to one fiscal period (uuid from list of periods).'),
}).passthrough()

const trialBalanceTool: OrvaFinanceAiToolDefinition = {
  name: 'orva_finance.get_trial_balance',
  displayName: 'Trial balance',
  description: 'Per-account debit/credit sums over posted journals with grand totals, optionally restricted to one fiscal period.',
  inputSchema: trialBalanceInput,
  requiredFeatures: ['orva_finance.gl.view'],
  tags: ['read', 'orva_finance', 'report'],
  handler: async (rawInput, ctx) => {
    const { tenantId, organizationId } = requireScope(ctx)
    const input = trialBalanceInput.parse(rawInput)
    const em = resolveEm(ctx)
    const rows = await withTenantRls(em, tenantId, async (tem) =>
      (await tem.execute(
        `select a.code, a.name, a.account_type,
                coalesce(sum(l.debit), 0)::text as total_debit,
                coalesce(sum(l.credit), 0)::text as total_credit
         from orva_gl_accounts a
         left join orva_gl_journal_lines l
           on l.account_id = a.id
          and l.deleted_at is null
          and exists (
            select 1 from orva_gl_journals j
            where j.id = l.journal_id
              and j.status = 'posted'
              and j.deleted_at is null
              and (?::uuid is null or j.period_id = ?::uuid)
              and (?::uuid is null or j.organization_id = ?::uuid)
          )
         where a.deleted_at is null
           and a.tenant_id = ?::uuid
           and (?::uuid is null or a.organization_id = ?::uuid)
         group by a.code, a.name, a.account_type
         order by a.code`,
        [
          input.periodId ?? null, input.periodId ?? null,
          organizationId ?? null, organizationId ?? null,
          tenantId,
          organizationId ?? null, organizationId ?? null,
        ],
      )) as Array<Record<string, unknown>>,
    )
    let debit = 0
    let credit = 0
    const accounts = rows.map((row) => {
      debit += Number(row.total_debit)
      credit += Number(row.total_credit)
      return {
        code: String(row.code),
        name: String(row.name),
        accountType: String(row.account_type),
        totalDebit: String(row.total_debit),
        totalCredit: String(row.total_credit),
      }
    })
    return {
      accounts: accounts.filter((a) => Number(a.totalDebit) !== 0 || Number(a.totalCredit) !== 0),
      totals: { debit: debit.toFixed(4), credit: credit.toFixed(4), balanced: debit.toFixed(4) === credit.toFixed(4) },
      href: '/backend/gl/trial-balance',
    }
  },
}

// ── orva_finance.get_statements ─────────────────────────────────────────────

const statementsInput = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('P&L range start (YYYY-MM-DD).'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('P&L range end / balance-sheet as-of (YYYY-MM-DD).'),
}).passthrough()

const statementsTool: OrvaFinanceAiToolDefinition = {
  name: 'orva_finance.get_statements',
  displayName: 'Financial statements',
  description: 'Profit & loss over [from, to] and a balance sheet cumulative up to `to`, computed from posted journals (P&L excludes closing journals).',
  inputSchema: statementsInput,
  requiredFeatures: ['orva_finance.gl.view'],
  tags: ['read', 'orva_finance', 'report'],
  handler: async (rawInput, ctx) => {
    const { tenantId, organizationId } = requireScope(ctx)
    const input = statementsInput.parse(rawInput)
    const em = resolveEm(ctx)
    const sumsQuery = (useFrom: boolean) => `
      select a.id as account_id, a.code, a.name, a.account_type,
             coalesce(sum(l.debit), 0)::text as debit,
             coalesce(sum(l.credit), 0)::text as credit
      from orva_gl_accounts a
      left join orva_gl_journal_lines l
        on l.account_id = a.id
       and l.deleted_at is null
       and exists (
         select 1 from orva_gl_journals j
         where j.id = l.journal_id
           and j.status = 'posted'
           and j.deleted_at is null
           ${useFrom ? `and j.journal_kind <> 'closing'` : ''}
           ${useFrom ? `and (?::date is null or j.journal_date >= ?::date)` : ''}
           and (?::date is null or j.journal_date <= ?::date)
           and (?::uuid is null or j.organization_id = ?::uuid)
       )
      where a.deleted_at is null
        and a.tenant_id = ?::uuid
        and (?::uuid is null or a.organization_id = ?::uuid)
      group by a.id, a.code, a.name, a.account_type`
    const toRows = (raw: Array<Record<string, unknown>>): AccountSums[] =>
      raw.map((row) => ({
        accountId: String(row.account_id),
        code: String(row.code),
        name: String(row.name),
        accountType: String(row.account_type),
        debit: String(row.debit),
        credit: String(row.credit),
      }))
    const { rangeSums, cumulativeSums } = await withTenantRls(em, tenantId, async (tem) => {
      const range = toRows(
        (await tem.execute(sumsQuery(true), [
          input.from ?? null, input.from ?? null,
          input.to ?? null, input.to ?? null,
          organizationId ?? null, organizationId ?? null,
          tenantId,
          organizationId ?? null, organizationId ?? null,
        ])) as Array<Record<string, unknown>>,
      )
      const cumulative = toRows(
        (await tem.execute(sumsQuery(false), [
          input.to ?? null, input.to ?? null,
          organizationId ?? null, organizationId ?? null,
          tenantId,
          organizationId ?? null, organizationId ?? null,
        ])) as Array<Record<string, unknown>>,
      )
      return { rangeSums: range, cumulativeSums: cumulative }
    })
    return {
      pl: buildProfitAndLoss(rangeSums),
      balanceSheet: buildBalanceSheet(cumulativeSums),
      href: '/backend/gl/statements',
    }
  },
}

// ── orva_finance.get_aging ──────────────────────────────────────────────────

const agingInput = z.object({
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('As-of date (YYYY-MM-DD), default today.'),
}).passthrough()

const agingTool: OrvaFinanceAiToolDefinition = {
  name: 'orva_finance.get_aging',
  displayName: 'AP/AR aging',
  description: 'Open payables (posted vendor bills with remaining balance) and receivables (GL-posted sales invoices minus posted receipts) bucketed by days overdue: current, 1–30, 31–60, 61–90, 90+.',
  inputSchema: agingInput,
  requiredFeatures: ['orva_finance.gl.view'],
  tags: ['read', 'orva_finance', 'report'],
  handler: async (rawInput, ctx) => {
    const { tenantId, organizationId } = requireScope(ctx)
    const input = agingInput.parse(rawInput)
    const asOf = input.asOf ?? new Date().toISOString().slice(0, 10)
    const em = resolveEm(ctx)
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
    return {
      asOf,
      ap: buildAging(asOf, apItems),
      ar: buildAging(asOf, arItems),
      href: '/backend/reports/aging',
    }
  },
}

// ── orva_finance.list_periods ───────────────────────────────────────────────

const listPeriodsInput = z.object({}).passthrough()

const listPeriodsTool: OrvaFinanceAiToolDefinition = {
  name: 'orva_finance.list_periods',
  displayName: 'List fiscal periods',
  description: 'List fiscal periods (code, start/end date, open/closed status) newest first. Use the period id with the trial balance tool.',
  inputSchema: listPeriodsInput,
  requiredFeatures: ['orva_finance.gl.view'],
  tags: ['read', 'orva_finance'],
  handler: async (_rawInput, ctx) => {
    const { tenantId, organizationId } = requireScope(ctx)
    const em = resolveEm(ctx)
    const rows = await withTenantRls(em, tenantId, async (tem) =>
      (await tem.execute(
        `select id, code, to_char(starts_on, 'YYYY-MM-DD') as start_date,
                to_char(ends_on, 'YYYY-MM-DD') as end_date, status
         from orva_fiscal_periods
         where deleted_at is null
           and tenant_id = ?::uuid
           and (?::uuid is null or organization_id = ?::uuid)
         order by starts_on desc
         limit 60`,
        [tenantId, organizationId ?? null, organizationId ?? null],
      )) as Array<Record<string, unknown>>,
    )
    return {
      periods: rows.map((row) => ({
        id: String(row.id),
        code: String(row.code),
        startDate: String(row.start_date),
        endDate: String(row.end_date),
        status: String(row.status),
      })),
    }
  },
}

export const aiTools: OrvaFinanceAiToolDefinition[] = [
  listAccountsTool,
  listJournalsTool,
  listPeriodsTool,
  trialBalanceTool,
  statementsTool,
  agingTool,
]

export default aiTools
