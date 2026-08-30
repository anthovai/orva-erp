import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import {
  ArInvoicePosting,
  ArReceipt,
  ArReceiptAllocation,
  ArSettings,
  FiscalPeriod,
  GlJournal,
  GlJournalLine,
} from '../../../../data/entities'
import { buildReceiptJournalLines } from '../../../../lib/ar'
import { allocateJournalNo, checkPostable } from '../../../../lib/posting'
import { receiptPostSchema } from '../../../../data/validators'
import { orvaFinanceTag } from '../../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['orva_finance.ar.post'] },
}

const postResponseSchema = z.object({
  ok: z.boolean(),
  receiptNo: z.string().nullable().optional(),
  journalNo: z.string().nullable().optional(),
  message: z.string().optional(),
})

/**
 * Posts a customer receipt: books a GL journal (debit cash, credit the AR
 * control account) and freezes the receipt. Remaining balances stay derived
 * (posted allocations), so nothing immutable is touched. Runs inside
 * withTenantRls; the GL journal guard revalidates at the database.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.sub) {
    return Response.json({ ok: false, message: 'Unauthorized' }, { status: 401 })
  }
  const parsed = receiptPostSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) {
    return Response.json({ ok: false, message: 'Invalid payload' }, { status: 400 })
  }
  const tenantId = auth.tenantId
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const result = await withTenantRls(em, tenantId, async (tem) => {
      const receipt = await tem.findOne(ArReceipt, { id: parsed.data.id, deletedAt: null })
      if (!receipt) throw Object.assign(new Error('Receipt not found'), { status: 404 })
      if (receipt.status !== 'draft') throw Object.assign(new Error('Only draft receipts can be posted'), { status: 400 })
      const allocations = await tem.find(ArReceiptAllocation, { receiptId: receipt.id, deletedAt: null })
      if (allocations.length === 0) throw Object.assign(new Error('Receipt has no allocations'), { status: 400 })

      const settings = await tem.findOne(ArSettings, { tenantId, organizationId: receipt.organizationId })
      if (!settings) {
        throw Object.assign(new Error('AR accounts are not configured (AR settings)'), { status: 400 })
      }
      const period = await tem.findOne(FiscalPeriod, { id: receipt.periodId, deletedAt: null })

      let total = 0
      for (const alloc of allocations) {
        const posting = await tem.findOne(ArInvoicePosting, { invoiceId: alloc.invoiceId, tenantId })
        if (!posting) throw Object.assign(new Error('Allocated invoice is not posted to the ledger'), { status: 400 })
        const rows = (await tem.execute(
          `select coalesce(sum(a.amount), 0) as received
           from orva_ar_receipt_allocations a
           join orva_ar_receipts r on r.id = a.receipt_id and r.status = 'posted' and r.deleted_at is null
           where a.invoice_id = ?::uuid and a.tenant_id = ?::uuid and a.deleted_at is null`,
          [alloc.invoiceId, tenantId],
        )) as Array<{ received: string | number }>
        const remaining = Number(posting.amount) - Number(rows[0]?.received ?? 0)
        if (Number(alloc.amount) > remaining + 0.00005) {
          throw Object.assign(
            new Error(`Invoice ${posting.invoiceNumber}: allocation exceeds remaining ${remaining.toFixed(4)}`),
            { status: 400 },
          )
        }
        total += Number(alloc.amount)
      }

      const journalLines = buildReceiptJournalLines(total, receipt.cashAccountId, settings.arAccountId)
      const verdict = checkPostable({
        journalStatus: 'draft',
        journalDate: String(receipt.receiptDate),
        lines: journalLines,
        period: period
          ? { status: period.status, startsOn: String(period.startsOn), endsOn: String(period.endsOn) }
          : null,
      })
      if (!verdict.ok) throw Object.assign(new Error(verdict.reason), { status: 400 })

      const now = new Date()
      const totalStr = total.toFixed(4)
      const journalNo = await allocateJournalNo(tem, tenantId, String(receipt.organizationId))
      const journal = tem.create(GlJournal, {
        tenantId,
        organizationId: String(receipt.organizationId),
        journalNo,
        status: 'draft',
        journalKind: 'standard',
        periodId: String(receipt.periodId),
        journalDate: String(receipt.receiptDate),
        currencyCode: receipt.currencyCode,
        memo: `AR receipt ${receipt.receiptNo ?? ''}`.trim(),
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
            organizationId: String(receipt.organizationId),
            journalId: journal.id,
            lineNo: index + 1,
            accountId: draft.accountId,
            partyId: receipt.customerPartyId ?? null,
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
      receipt.status = 'posted'
      receipt.journalId = journal.id
      receipt.postedAt = now
      receipt.postedBy = auth.sub ?? null
      receipt.totalAmount = totalStr
      await tem.flush()
      return { receiptNo: receipt.receiptNo ?? null, journalNo }
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
  summary: 'Post a customer receipt',
  methods: {
    POST: {
      summary: 'Post a draft customer receipt to the ledger',
      description:
        'Books a balanced GL journal (debit cash, credit AR control) and freezes the receipt. Overallocation beyond an invoice remaining balance is rejected.',
      tags: [orvaFinanceTag],
      requestBody: { schema: receiptPostSchema },
      responses: [{ status: 200, description: 'Receipt posted with its journal number.', schema: postResponseSchema }],
      errors: [
        { status: 400, description: 'Not postable (overallocation, unposted invoice, AR accounts unset, closed period, not a draft)', schema: postResponseSchema },
        { status: 401, description: 'Authentication required', schema: postResponseSchema },
        { status: 404, description: 'Receipt not found', schema: postResponseSchema },
      ],
    },
  },
}
