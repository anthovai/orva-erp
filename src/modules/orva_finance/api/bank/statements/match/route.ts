import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { BankStatementLine } from '../../../../data/entities'
import { bankStatementMatchSchema } from '../../../../data/validators'
import { orvaFinanceTag } from '../../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['orva_finance.gl.manage'] },
}

const responseSchema = z.object({ ok: z.boolean(), message: z.string().optional() })

/**
 * Pins a statement line to one posted GL line of the same account (amounts
 * must agree to the satang), releases the match, or excludes the line
 * (bank fees the books never saw, duplicates on the statement).
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ ok: false, message: 'Unauthorized' }, { status: 401 })
  const parsed = bankStatementMatchSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ ok: false, message: 'Invalid payload' }, { status: 400 })
  const tenantId = auth.tenantId
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    await withTenantRls(em, tenantId, async (tem) => {
      const line = await tem.findOne(BankStatementLine, { id: parsed.data.lineId, tenantId, deletedAt: null })
      if (!line) throw Object.assign(new Error('Statement line not found'), { status: 404 })
      const status = parsed.data.status ?? (parsed.data.journalLineId ? 'matched' : 'unmatched')
      if (status === 'matched') {
        if (!parsed.data.journalLineId) throw Object.assign(new Error('journalLineId is required to match'), { status: 400 })
        const gl = (await tem.execute(
          `select (l.debit - l.credit)::text as amount
           from orva_gl_journal_lines l
           join orva_gl_journals j on j.id = l.journal_id and j.status = 'posted' and j.deleted_at is null
           where l.id = ?::uuid and l.tenant_id = ?::uuid and l.account_id = ?::uuid and l.deleted_at is null`,
          [parsed.data.journalLineId, tenantId, line.accountId],
        )) as Array<{ amount: string }>
        if (!gl[0]) throw Object.assign(new Error('Ledger line not found on this account'), { status: 400 })
        if (Math.abs(Number(gl[0].amount) - Number(line.amount)) > 0.005) {
          throw Object.assign(new Error(`Amounts differ: statement ${Number(line.amount).toFixed(2)} vs ledger ${Number(gl[0].amount).toFixed(2)}`), { status: 400 })
        }
        line.journalLineId = parsed.data.journalLineId
        line.status = 'matched'
      } else {
        line.journalLineId = null
        line.status = status
      }
      line.updatedAt = new Date()
      await tem.flush()
    })
    return Response.json({ ok: true })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    const message = error instanceof Error ? error.message : 'Match failed'
    // the unique index on journal_line_id surfaces as a 23505
    return Response.json({ ok: false, message: /unique|duplicate/i.test(message) ? 'That ledger line is already matched' : message }, { status: /unique|duplicate/i.test(message) ? 400 : status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaFinanceTag,
  summary: 'Match a bank statement line',
  methods: {
    POST: {
      summary: 'Match / unmatch / exclude a statement line against the ledger',
      tags: [orvaFinanceTag],
      requestBody: { schema: bankStatementMatchSchema },
      responses: [{ status: 200, description: 'Updated.', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Amount mismatch, wrong account, or ledger line already matched', schema: responseSchema },
        { status: 404, description: 'Statement line not found', schema: responseSchema },
      ],
    },
  },
}
