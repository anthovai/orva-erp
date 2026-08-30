import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { FiscalPeriod, GlJournal, GlJournalLine, GlSettings } from '../../../../data/entities'
import { buildClosingLines } from '../../../../lib/closing'
import type { AccountSums } from '../../../../lib/statements'
import { allocateJournalNo } from '../../../../lib/posting'
import { periodCloseSchema } from '../../../../data/validators'
import { orvaFinanceTag } from '../../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['orva_finance.gl.post'] },
}

const responseSchema = z.object({
  ok: z.boolean(),
  journalNo: z.string().nullable().optional(),
  netProfit: z.string().optional(),
  closedAccounts: z.number().optional(),
  message: z.string().optional(),
})

/**
 * Closes a fiscal period properly: books a 'closing' journal that zeroes the
 * period's income and expense into retained earnings, then flips the period
 * to closed — all in one withTenantRls transaction. The closing journal
 * posts while the period is still open (the GL guard requires that), and a
 * partial unique index guarantees at most one closing journal per period.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.sub) {
    return Response.json({ ok: false, message: 'Unauthorized' }, { status: 401 })
  }
  const parsed = periodCloseSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) {
    return Response.json({ ok: false, message: 'Invalid payload' }, { status: 400 })
  }
  const tenantId = auth.tenantId
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const result = await withTenantRls(em, tenantId, async (tem) => {
      const period = await tem.findOne(FiscalPeriod, { id: parsed.data.periodId, deletedAt: null })
      if (!period) throw Object.assign(new Error('Period not found'), { status: 404 })
      if (period.status !== 'open') throw Object.assign(new Error('Period is already closed'), { status: 400 })
      const existingClosing = await tem.findOne(GlJournal, {
        periodId: period.id, journalKind: 'closing', deletedAt: null,
      })
      if (existingClosing) {
        throw Object.assign(new Error(`Period already has closing journal ${existingClosing.journalNo}`), { status: 400 })
      }
      const settings = await tem.findOne(GlSettings, { tenantId, organizationId: period.organizationId })
      if (!settings) {
        throw Object.assign(new Error('Retained earnings account is not configured (GL settings)'), { status: 400 })
      }

      const sums = (await tem.execute(
        `select a.id as account_id, a.code, a.name, a.account_type,
                coalesce(sum(l.debit), 0)::text as debit,
                coalesce(sum(l.credit), 0)::text as credit
         from orva_gl_journal_lines l
         join orva_gl_accounts a on a.id = l.account_id
         join orva_gl_journals j on j.id = l.journal_id
         where j.period_id = ?::uuid
           and j.status = 'posted'
           and j.deleted_at is null
           and l.deleted_at is null
           and a.account_type in ('income','expense')
         group by a.id, a.code, a.name, a.account_type`,
        [period.id],
      )) as Array<Record<string, unknown>>
      const periodSums: AccountSums[] = sums.map((row) => ({
        accountId: String(row.account_id),
        code: String(row.code),
        name: String(row.name),
        accountType: String(row.account_type),
        debit: String(row.debit),
        credit: String(row.credit),
      }))

      const plan = buildClosingLines(periodSums, settings.retainedEarningsAccountId)
      const totalDebit = plan.lines.reduce((sum, line) => sum + Number(line.debit), 0).toFixed(4)

      const now = new Date()
      const journalNo = await allocateJournalNo(tem, tenantId, String(period.organizationId))
      const journal = tem.create(GlJournal, {
        tenantId,
        organizationId: String(period.organizationId),
        journalNo,
        status: 'draft',
        journalKind: 'closing',
        periodId: String(period.id),
        journalDate: String(period.endsOn),
        currencyCode: 'THB',
        memo: `Closing ${period.code}`,
        totalDebit,
        totalCredit: totalDebit,
        createdBy: auth.sub ?? null,
        createdAt: now,
        updatedAt: now,
      })
      tem.persist(journal)
      // Flush the header first: the uuid PK is DB-generated, so journal.id
      // is only hydrated after this flush and the lines need it for their FK.
      await tem.flush()
      plan.lines.forEach((draft, index) => {
        tem.persist(
          tem.create(GlJournalLine, {
            tenantId,
            organizationId: String(period.organizationId),
            journalId: journal.id,
            lineNo: index + 1,
            accountId: draft.accountId,
            partyId: null,
            debit: draft.debit,
            credit: draft.credit,
            description: draft.description,
            createdAt: now,
            updatedAt: now,
          }),
        )
      })
      await tem.flush()

      // Post the closing journal while the period is still open (DB guard),
      // then close the period in the same transaction.
      journal.status = 'posted'
      journal.postedAt = now
      journal.postedBy = auth.sub ?? null
      period.status = 'closed'
      await tem.flush()
      return { journalNo, netProfit: plan.netProfit, closedAccounts: plan.closedAccounts }
    })
    return Response.json({ ok: true, ...result })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    const message = error instanceof Error ? error.message : 'Closing failed'
    return Response.json({ ok: false, message }, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaFinanceTag,
  summary: 'Close a fiscal period',
  methods: {
    POST: {
      summary: 'Book closing entries into retained earnings and close the period',
      description:
        'Zeroes the period\'s income and expense accounts into retained earnings with a single closing journal, then marks the period closed. At most one closing journal can ever exist per period.',
      tags: [orvaFinanceTag],
      requestBody: { schema: periodCloseSchema },
      responses: [{ status: 200, description: 'Period closed with its closing journal.', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Not closable (already closed, nothing to close, RE account unset)', schema: responseSchema },
        { status: 401, description: 'Authentication required', schema: responseSchema },
        { status: 404, description: 'Period not found', schema: responseSchema },
      ],
    },
  },
}
