import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { FiscalPeriod, GlJournal, GlJournalLine } from '../../../../data/entities'
import { allocateJournalNo, checkPostable } from '../../../../lib/posting'
import { journalReverseSchema } from '../../../../data/validators'
import { orvaFinanceTag } from '../../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['orva_finance.gl.post'] },
}

const responseSchema = z.object({
  ok: z.boolean(),
  journalNo: z.string().nullable().optional(),
  message: z.string().optional(),
})

/**
 * Reverses a POSTED journal with a new posted journal whose lines swap debit
 * and credit (ใบกลับรายการ). Posted entries are never edited or deleted — the
 * ledger keeps both, and the unique index on reversal_of_id makes a second
 * reversal impossible. The reversal is dated by the caller, inside an open
 * period, so a closed month is never touched.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.sub) {
    return Response.json({ ok: false, message: 'Unauthorized' }, { status: 401 })
  }
  const parsed = journalReverseSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) {
    return Response.json({ ok: false, message: 'Invalid payload' }, { status: 400 })
  }
  const tenantId = auth.tenantId
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const journalNo = await withTenantRls(em, tenantId, async (tem) => {
      const original = await tem.findOne(GlJournal, { id: parsed.data.id, deletedAt: null })
      if (!original) throw Object.assign(new Error('Journal not found'), { status: 404 })
      if (original.status !== 'posted') throw Object.assign(new Error('Only posted journals can be reversed'), { status: 400 })
      if (original.journalKind === 'closing') throw Object.assign(new Error('Closing journals cannot be reversed — reopen the period instead'), { status: 400 })
      const already = await tem.findOne(GlJournal, { reversalOfId: original.id, deletedAt: null })
      if (already) throw Object.assign(new Error(`Journal ${original.journalNo} is already reversed by ${already.journalNo}`), { status: 400 })

      const period = await tem.findOne(FiscalPeriod, {
        tenantId,
        organizationId: original.organizationId,
        deletedAt: null,
        startsOn: { $lte: parsed.data.reversalDate },
        endsOn: { $gte: parsed.data.reversalDate },
      })
      if (!period) throw Object.assign(new Error('No fiscal period covers the reversal date'), { status: 400 })

      const lines = await tem.find(GlJournalLine, { journalId: original.id, deletedAt: null }, { orderBy: { lineNo: 'asc' } })
      const swapped = lines.map((line) => ({
        accountId: line.accountId,
        partyId: line.partyId ?? null,
        debit: String(line.credit),
        credit: String(line.debit),
        description: `Reversal — ${line.description ?? ''}`.trim(),
      }))
      const verdict = checkPostable({
        journalStatus: 'draft',
        journalDate: parsed.data.reversalDate,
        lines: swapped,
        period: { status: period.status, startsOn: String(period.startsOn), endsOn: String(period.endsOn) },
      })
      if (!verdict.ok) throw Object.assign(new Error(verdict.reason), { status: 400 })

      const now = new Date()
      const journalNo = await allocateJournalNo(tem, tenantId, original.organizationId)
      const reversal = tem.create(GlJournal, {
        tenantId,
        organizationId: original.organizationId,
        journalNo,
        status: 'draft',
        journalKind: 'reversal',
        reversalOfId: original.id,
        periodId: period.id,
        journalDate: parsed.data.reversalDate,
        currencyCode: original.currencyCode,
        memo: parsed.data.memo?.trim() || `Reversal of ${original.journalNo}${original.memo ? ` — ${original.memo}` : ''}`,
        totalDebit: original.totalCredit,
        totalCredit: original.totalDebit,
        createdBy: auth.sub ?? null,
        createdAt: now,
        updatedAt: now,
      })
      tem.persist(reversal)
      // header first: the uuid PK is DB-generated and the lines need it
      await tem.flush()
      swapped.forEach((draft, index) => {
        tem.persist(
          tem.create(GlJournalLine, {
            tenantId,
            organizationId: original.organizationId,
            journalId: reversal.id,
            lineNo: index + 1,
            accountId: draft.accountId,
            partyId: draft.partyId,
            debit: draft.debit,
            credit: draft.credit,
            description: draft.description,
            createdAt: now,
            updatedAt: now,
          }),
        )
      })
      await tem.flush()
      reversal.status = 'posted'
      reversal.postedAt = now
      reversal.postedBy = auth.sub ?? null
      await tem.flush()
      return journalNo
    })
    return Response.json({ ok: true, journalNo })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    const message = error instanceof Error ? error.message : 'Reversal failed'
    return Response.json({ ok: false, message }, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaFinanceTag,
  summary: 'Reverse a posted GL journal',
  methods: {
    POST: {
      summary: 'Post a reversal journal (debits and credits swapped) for a posted journal',
      description:
        'The original stays untouched; the reversal carries reversal_of_id and a unique index prevents a second reversal. Dated by the caller inside an open period.',
      tags: [orvaFinanceTag],
      requestBody: { schema: journalReverseSchema },
      responses: [{ status: 200, description: 'Reversal posted with its journal number.', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Not reversible (draft, closing, already reversed, no open period)', schema: responseSchema },
        { status: 401, description: 'Authentication required', schema: responseSchema },
        { status: 404, description: 'Journal not found', schema: responseSchema },
      ],
    },
  },
}
