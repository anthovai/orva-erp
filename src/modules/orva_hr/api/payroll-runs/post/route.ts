import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { FiscalPeriod, GlJournal, GlJournalLine } from '@/modules/orva_finance/data/entities'
import { allocateJournalNo, checkPostable } from '@/modules/orva_finance/lib/posting'
import { HrSettings, PayrollRun } from '../../../data/entities'
import { buildPayrollJournalLines } from '../../../lib/payroll'
import { payrollActionSchema } from '../../../data/validators'
import { orvaHrTag } from '../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['orva_hr.payroll.post'] },
}

const responseSchema = z.object({
  ok: z.boolean(),
  runNo: z.string().nullable().optional(),
  journalNo: z.string().nullable().optional(),
  message: z.string().optional(),
})

/**
 * Posts a calculated payroll run into the GL:
 *   debit salary expense + SSO employer expense,
 *   credit SSO payable, tax payable, net payable.
 * The GL journal guard revalidates balance/period; the payroll run guard
 * freezes the run afterwards.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.sub) {
    return Response.json({ ok: false, message: 'Unauthorized' }, { status: 401 })
  }
  const parsed = payrollActionSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ ok: false, message: 'Invalid payload' }, { status: 400 })
  const tenantId = auth.tenantId
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const result = await withTenantRls(em, tenantId, async (tem) => {
      const run = await tem.findOne(PayrollRun, { id: parsed.data.id, deletedAt: null })
      if (!run) throw Object.assign(new Error('Payroll run not found'), { status: 404 })
      if (run.status !== 'calculated') {
        throw Object.assign(new Error('Only calculated runs can be posted — calculate first'), { status: 400 })
      }
      const settings = await tem.findOne(HrSettings, { tenantId, organizationId: run.organizationId })
      if (!settings) {
        throw Object.assign(new Error('Payroll GL accounts are not configured (HR settings)'), { status: 400 })
      }
      const period = await tem.findOne(FiscalPeriod, { id: run.periodId, deletedAt: null })

      const journalLines = buildPayrollJournalLines(
        {
          gross: Number(run.totalGross),
          ssoEmployee: Number(run.totalSsoEmployee),
          ssoEmployer: Number(run.totalSsoEmployer),
          wht: Number(run.totalWht),
          net: Number(run.totalNet),
        },
        settings,
      )
      const verdict = checkPostable({
        journalStatus: 'draft',
        journalDate: String(run.payDate),
        lines: journalLines,
        period: period
          ? { status: period.status, startsOn: String(period.startsOn), endsOn: String(period.endsOn) }
          : null,
      })
      if (!verdict.ok) throw Object.assign(new Error(verdict.reason), { status: 400 })

      const now = new Date()
      const totalDebit = journalLines.reduce((sum, line) => sum + Number(line.debit), 0).toFixed(4)
      const journalNo = await allocateJournalNo(tem, tenantId, String(run.organizationId))
      const journal = tem.create(GlJournal, {
        tenantId,
        organizationId: String(run.organizationId),
        journalNo,
        status: 'draft',
        journalKind: 'standard',
        periodId: String(run.periodId),
        journalDate: String(run.payDate),
        currencyCode: 'THB',
        memo: `Payroll ${run.monthCode} (${run.runNo ?? ''})`.trim(),
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
      journalLines.forEach((draft, index) => {
        tem.persist(
          tem.create(GlJournalLine, {
            tenantId,
            organizationId: String(run.organizationId),
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

      journal.status = 'posted'
      journal.postedAt = now
      journal.postedBy = auth.sub ?? null
      run.status = 'posted'
      run.journalId = journal.id
      run.postedAt = now
      run.postedBy = auth.sub ?? null
      await tem.flush()
      return { runNo: run.runNo ?? null, journalNo }
    })
    return Response.json({ ok: true, ...result })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    const message = error instanceof Error ? error.message : 'Posting failed'
    return Response.json({ ok: false, message }, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaHrTag,
  summary: 'Post a payroll run',
  methods: {
    POST: {
      summary: 'Post a calculated payroll run to the ledger',
      description:
        'Books salary + employer SSO as expenses against SSO/tax/net payables, then freezes the run. DB triggers enforce the same invariants.',
      tags: [orvaHrTag],
      requestBody: { schema: payrollActionSchema },
      responses: [{ status: 200, description: 'Run posted with its journal number.', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Not postable (not calculated, HR accounts unset, closed period)', schema: responseSchema },
        { status: 401, description: 'Authentication required', schema: responseSchema },
        { status: 404, description: 'Run not found', schema: responseSchema },
      ],
    },
  },
}
