import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { BankStatementLine, GlAccount } from '../../../data/entities'
import { bankStatementImportSchema, bankStatementListSchema } from '../../../data/validators'
import { orvaFinanceTag } from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_finance.gl.view'] },
  POST: { requireAuth: true, requireFeatures: ['orva_finance.gl.manage'] },
}

const lineSchema = z.object({
  id: z.string().uuid(),
  txn_date: z.string(),
  description: z.string().nullable(),
  reference: z.string().nullable(),
  amount: z.string(),
  status: z.string(),
  journal_line_id: z.string().uuid().nullable(),
})

const glLineSchema = z.object({
  journal_line_id: z.string().uuid(),
  journal_no: z.string().nullable(),
  journal_date: z.string(),
  description: z.string().nullable(),
  memo: z.string().nullable(),
  /** signed like the bank: debit to a cash account = money in (+) */
  amount: z.string(),
  matched: z.boolean(),
})

const listResponseSchema = z.object({
  statement: z.array(lineSchema),
  ledger: z.array(glLineSchema),
  summary: z.object({
    statementBalance: z.string(),
    ledgerBalance: z.string(),
    unmatchedStatement: z.number(),
    unmatchedLedger: z.number(),
  }),
})

/**
 * Both sides of a reconciliation for one bank account: imported statement
 * lines and the account's posted GL lines, each flagged matched/unmatched.
 */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const tenantId = auth.tenantId
  const organizationId = resolveActiveOrganizationId(auth)
  const parsed = bankStatementListSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const { accountId, from, to } = parsed.data

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const result = await withTenantRls(em, tenantId, async (tem) => {
    const statement = (await tem.execute(
      `select id, to_char(txn_date, 'YYYY-MM-DD') as txn_date, description, reference, amount::text, status, journal_line_id
       from orva_bank_statement_lines
       where tenant_id = ?::uuid and account_id = ?::uuid and deleted_at is null
         and (?::date is null or txn_date >= ?::date) and (?::date is null or txn_date <= ?::date)
       order by txn_date, created_at`,
      [tenantId, accountId, from ?? null, from ?? null, to ?? null, to ?? null],
    )) as Array<z.infer<typeof lineSchema>>
    const ledger = (await tem.execute(
      `select l.id as journal_line_id, j.journal_no, to_char(j.journal_date, 'YYYY-MM-DD') as journal_date,
              l.description, j.memo, (l.debit - l.credit)::text as amount,
              exists (select 1 from orva_bank_statement_lines s where s.journal_line_id = l.id and s.deleted_at is null) as matched
       from orva_gl_journal_lines l
       join orva_gl_journals j on j.id = l.journal_id and j.status = 'posted' and j.deleted_at is null
       where l.tenant_id = ?::uuid and l.account_id = ?::uuid and l.deleted_at is null
         and (?::uuid is null or j.organization_id = ?::uuid)
         and (?::date is null or j.journal_date >= ?::date) and (?::date is null or j.journal_date <= ?::date)
       order by j.journal_date, j.journal_no, l.line_no`,
      [tenantId, accountId, organizationId ?? null, organizationId ?? null, from ?? null, from ?? null, to ?? null, to ?? null],
    )) as Array<z.infer<typeof glLineSchema>>
    const sum = (rows: Array<{ amount: string }>) => rows.reduce((s, r) => s + Number(r.amount), 0)
    return {
      statement,
      ledger,
      summary: {
        statementBalance: sum(statement.filter((s) => s.status !== 'excluded')).toFixed(2),
        ledgerBalance: sum(ledger).toFixed(2),
        unmatchedStatement: statement.filter((s) => s.status === 'unmatched').length,
        unmatchedLedger: ledger.filter((l) => !l.matched).length,
      },
    }
  })
  return Response.json(result)
}

/** Imports statement lines (already parsed client-side) for one bank account as one batch. */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.sub) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = bankStatementImportSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const tenantId = auth.tenantId
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const imported = await withTenantRls(em, tenantId, async (tem) => {
      const account = await tem.findOne(GlAccount, { id: parsed.data.accountId, tenantId, deletedAt: null })
      if (!account) throw Object.assign(new Error('Account not found'), { status: 404 })
      if (account.accountType !== 'asset') throw Object.assign(new Error('Statements attach to a cash/bank asset account'), { status: 400 })
      const batchId = crypto.randomUUID()
      const now = new Date()
      // idempotent per (date, amount, description): re-importing the same file adds nothing
      let count = 0
      for (const line of parsed.data.lines) {
        const dup = (await tem.execute(
          `select 1 from orva_bank_statement_lines
           where tenant_id = ?::uuid and account_id = ?::uuid and deleted_at is null
             and txn_date = ?::date and amount = ? and coalesce(description, '') = ?`,
          [tenantId, parsed.data.accountId, line.txnDate, line.amount.toFixed(4), line.description ?? ''],
        )) as unknown[]
        if (dup.length) continue
        tem.persist(tem.create(BankStatementLine, {
          tenantId, organizationId, accountId: parsed.data.accountId, batchId,
          txnDate: line.txnDate, description: line.description ?? null, reference: line.reference ?? null,
          amount: line.amount.toFixed(4), status: 'unmatched', journalLineId: null,
          createdBy: auth.sub ?? null, createdAt: now, updatedAt: now,
        }))
        count++
      }
      await tem.flush()
      return { batchId, imported: count, skipped: parsed.data.lines.length - count }
    })
    return Response.json({ ok: true, ...imported })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json({ error: error instanceof Error ? error.message : 'Import failed' }, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaFinanceTag,
  summary: 'Bank statement lines (reconciliation)',
  methods: {
    GET: {
      summary: 'Statement lines and the account ledger lines, with match flags',
      tags: [orvaFinanceTag],
      query: bankStatementListSchema,
      responses: [{ status: 200, description: 'Both sides of the reconciliation.', schema: listResponseSchema }],
    },
    POST: {
      summary: 'Import parsed statement lines for one bank account (duplicates skipped)',
      tags: [orvaFinanceTag],
      requestBody: { schema: bankStatementImportSchema },
      responses: [{ status: 200, description: 'Import result.', schema: z.object({ ok: z.boolean(), batchId: z.string(), imported: z.number(), skipped: z.number() }) }],
    },
  },
}
