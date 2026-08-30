import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { FiscalPeriod, GlJournal, GlJournalLine } from '../../../../data/entities'
import { checkPostable, computeTotals } from '../../../../lib/posting'
import { journalPostSchema } from '../../../../data/validators'
import { orvaFinanceTag } from '../../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['orva_finance.gl.post'] },
}

const postResponseSchema = z.object({
  ok: z.boolean(),
  journalNo: z.string().nullable().optional(),
  message: z.string().optional(),
})

/**
 * Posts a draft journal: balance check, open-period check, date-in-period
 * check, then the draft -> posted transition. Runs inside withTenantRls, and
 * the orva_gl_journal_guard DB trigger revalidates the same rules — a bug in
 * this handler cannot post an unbalanced journal.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.sub) {
    return Response.json({ ok: false, message: 'Unauthorized' }, { status: 401 })
  }
  const parsed = journalPostSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) {
    return Response.json({ ok: false, message: 'Invalid payload' }, { status: 400 })
  }
  const tenantId = auth.tenantId
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const journalNo = await withTenantRls(em, tenantId, async (tem) => {
      const journal = await tem.findOne(GlJournal, { id: parsed.data.id, deletedAt: null })
      if (!journal) throw Object.assign(new Error('Journal not found'), { status: 404 })
      const lines = await tem.find(GlJournalLine, { journalId: journal.id, deletedAt: null })
      const period = await tem.findOne(FiscalPeriod, { id: journal.periodId, deletedAt: null })
      const verdict = checkPostable({
        journalStatus: journal.status,
        journalDate: String(journal.journalDate),
        lines,
        period: period
          ? { status: period.status, startsOn: String(period.startsOn), endsOn: String(period.endsOn) }
          : null,
      })
      if (!verdict.ok) throw Object.assign(new Error(verdict.reason), { status: 400 })
      const totals = computeTotals(lines)
      journal.totalDebit = totals.totalDebit
      journal.totalCredit = totals.totalCredit
      journal.status = 'posted'
      journal.postedAt = new Date()
      journal.postedBy = auth.sub ?? null
      await tem.flush()
      return journal.journalNo ?? null
    })
    return Response.json({ ok: true, journalNo })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    const message = error instanceof Error ? error.message : 'Posting failed'
    return Response.json({ ok: false, message }, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaFinanceTag,
  summary: 'Post a draft GL journal',
  methods: {
    POST: {
      summary: 'Post a draft GL journal',
      description:
        'Validates balance, open period, and date-in-period, then transitions the journal from draft to posted. Posted journals are immutable (DB-enforced).',
      tags: [orvaFinanceTag],
      requestBody: { schema: journalPostSchema },
      responses: [
        { status: 200, description: 'Journal posted.', schema: postResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Not postable (unbalanced, closed period, date outside period, not a draft)', schema: postResponseSchema },
        { status: 401, description: 'Authentication required', schema: postResponseSchema },
        { status: 404, description: 'Journal not found', schema: postResponseSchema },
      ],
    },
  },
}
