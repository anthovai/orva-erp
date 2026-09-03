import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import {
  ApBill,
  ApPayment,
  ApPaymentAllocation,
  ApSettings,
  FiscalPeriod,
  GlJournal,
  GlJournalLine,
} from '../../../../data/entities'
import { buildPaymentJournalLines, checkAllocationFits } from '../../../../lib/ap'
import { allocateJournalNo, checkPostable } from '../../../../lib/posting'
import { paymentPostSchema } from '../../../../data/validators'
import { orvaFinanceTag } from '../../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['orva_finance.ap.post'] },
}

const postResponseSchema = z.object({
  ok: z.boolean(),
  paymentNo: z.string().nullable().optional(),
  journalNo: z.string().nullable().optional(),
  message: z.string().optional(),
})

/**
 * Posts a vendor payment: books a GL journal (debit the AP control account,
 * credit the cash account), adds each allocation to its bill's paid_amount,
 * and freezes the payment. Runs inside withTenantRls; the GL journal guard
 * and the relaxed bill guard revalidate everything at the database.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.sub) {
    return Response.json({ ok: false, message: 'Unauthorized' }, { status: 401 })
  }
  const parsed = paymentPostSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) {
    return Response.json({ ok: false, message: 'Invalid payload' }, { status: 400 })
  }
  const tenantId = auth.tenantId
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const result = await withTenantRls(em, tenantId, async (tem) => {
      const payment = await tem.findOne(ApPayment, { id: parsed.data.id, deletedAt: null })
      if (!payment) throw Object.assign(new Error('Payment not found'), { status: 404 })
      if (payment.status !== 'draft') throw Object.assign(new Error('Only draft payments can be posted'), { status: 400 })
      const allocations = await tem.find(ApPaymentAllocation, { paymentId: payment.id, deletedAt: null })
      if (allocations.length === 0) throw Object.assign(new Error('Payment has no allocations'), { status: 400 })

      const settings = await tem.findOne(ApSettings, { tenantId, organizationId: payment.organizationId })
      if (!settings) {
        throw Object.assign(new Error('AP control account is not configured (AP settings)'), { status: 400 })
      }
      const period = await tem.findOne(FiscalPeriod, { id: payment.periodId, deletedAt: null })

      let total = 0
      const bills = new Map<string, ApBill>()
      for (const alloc of allocations) {
        const bill = await tem.findOne(ApBill, { id: alloc.billId, deletedAt: null })
        if (!bill) throw Object.assign(new Error('Allocated bill not found'), { status: 400 })
        if (bill.status !== 'posted') {
          throw Object.assign(new Error(`Bill ${bill.billNo ?? bill.id} is not posted`), { status: 400 })
        }
        const fits = checkAllocationFits(bill.totalAmount, bill.paidAmount, alloc.amount)
        if (!fits.ok) throw Object.assign(new Error(`Bill ${bill.billNo ?? bill.id}: ${fits.reason}`), { status: 400 })
        bills.set(bill.id, bill)
        total += Number(alloc.amount)
      }

      const wht = Number(payment.whtAmount ?? 0)
      const journalLines = buildPaymentJournalLines(
        total, settings.apAccountId, payment.cashAccountId, wht, settings.whtPayableAccountId,
      )
      const verdict = checkPostable({
        journalStatus: 'draft',
        journalDate: String(payment.paymentDate),
        lines: journalLines,
        period: period
          ? { status: period.status, startsOn: String(period.startsOn), endsOn: String(period.endsOn) }
          : null,
      })
      if (!verdict.ok) throw Object.assign(new Error(verdict.reason), { status: 400 })

      const now = new Date()
      const totalStr = total.toFixed(4)
      const journalNo = await allocateJournalNo(tem, tenantId, String(payment.organizationId))
      const journal = tem.create(GlJournal, {
        tenantId,
        organizationId: String(payment.organizationId),
        journalNo,
        status: 'draft',
        journalKind: 'standard',
        periodId: String(payment.periodId),
        journalDate: String(payment.paymentDate),
        currencyCode: payment.currencyCode,
        memo: `AP payment ${payment.paymentNo ?? ''}`.trim(),
        totalDebit: totalStr,
        totalCredit: totalStr,
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
            organizationId: String(payment.organizationId),
            journalId: journal.id,
            lineNo: index + 1,
            accountId: draft.accountId,
            partyId: payment.vendorPartyId,
            debit: draft.debit,
            credit: draft.credit,
            description: draft.description,
            createdAt: now,
            updatedAt: now,
          }),
        )
      })
      await tem.flush()

      // draft -> posted runs the GL DB guard (balance, open period, date).
      journal.status = 'posted'
      journal.postedAt = now
      journal.postedBy = auth.sub ?? null
      // a withholding certificate (50 ทวิ) number is allocated the moment tax is withheld
      if (wht > 0 && !payment.whtCertNo) {
        const rows = (await tem.execute(
          "insert into orva_gl_sequences as s (tenant_id, organization_id, kind, next_value) values (?, ?, 'wht_cert', 2) on conflict (tenant_id, organization_id, kind) do update set next_value = s.next_value + 1 returning next_value - 1 as seq",
          [tenantId, String(payment.organizationId)],
        )) as Array<{ seq: string | number }>
        payment.whtCertNo = 'WHT-' + String(Number(rows[0]?.seq ?? 0)).padStart(6, '0')
      }

      // Settle the bills â€” the relaxed bill guard allows exactly this change.
      for (const alloc of allocations) {
        const bill = bills.get(alloc.billId)
        if (!bill) continue
        bill.paidAmount = (Number(bill.paidAmount) + Number(alloc.amount)).toFixed(4)
      }

      payment.status = 'posted'
      payment.journalId = journal.id
      payment.postedAt = now
      payment.postedBy = auth.sub ?? null
      payment.totalAmount = totalStr
      await tem.flush()
      return { paymentNo: payment.paymentNo ?? null, journalNo }
    })
    return Response.json({ ok: true, ...result })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    const message = error instanceof Error ? error.message : 'Posting failed'
    return Response.json({ ok: false, message }, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaFinanceTag,
  summary: 'Post a vendor payment',
  methods: {
    POST: {
      summary: 'Post a draft vendor payment to the ledger',
      description:
        'Books a balanced GL journal (debit AP control, credit cash), adds each allocation to its bill paid_amount, and freezes the payment. DB triggers enforce the same invariants.',
      tags: [orvaFinanceTag],
      requestBody: { schema: paymentPostSchema },
      responses: [{ status: 200, description: 'Payment posted with its journal number.', schema: postResponseSchema }],
      errors: [
        { status: 400, description: 'Not postable (overallocation, unposted bill, AP account unset, closed period, not a draft)', schema: postResponseSchema },
        { status: 401, description: 'Authentication required', schema: postResponseSchema },
        { status: 404, description: 'Payment not found', schema: postResponseSchema },
      ],
    },
  },
}
