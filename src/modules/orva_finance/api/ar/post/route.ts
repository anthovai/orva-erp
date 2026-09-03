import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { PartyLink } from '@/modules/orva_party/data/entities'
import { ArInvoicePosting, ArSettings, FiscalPeriod, GlJournal, GlJournalLine } from '../../../data/entities'
import { buildArJournalLines } from '../../../lib/ar'
import { allocateJournalNo, checkPostable } from '../../../lib/posting'
import { arPostSchema } from '../../../data/validators'
import { orvaFinanceTag } from '../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['orva_finance.ar.post'] },
}

const resultSchema = z.object({
  ok: z.boolean(),
  posted: z.array(z.object({ invoiceNumber: z.string(), journalNo: z.string() })),
  message: z.string().optional(),
})

type InvoiceRow = {
  id: string
  organization_id: string
  invoice_number: string
  currency_code: string
  grand_total_gross_amount: string
  tax_total_amount: string
}

/**
 * Books selected sales invoices into the GL: one journal per invoice
 * (debit AR control, credit revenue [+ tax payable]), plus an immutable
 * orva_ar_invoice_postings record whose unique index makes double-posting
 * impossible. All-or-nothing: any failure rolls back the whole batch.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.sub) {
    return Response.json({ ok: false, posted: [], message: 'Unauthorized' }, { status: 401 })
  }
  const parsed = arPostSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) {
    return Response.json({ ok: false, posted: [], message: 'Invalid payload' }, { status: 400 })
  }
  const tenantId = auth.tenantId
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const posted = await withTenantRls(em, tenantId, async (tem) => {
      const period = await tem.findOne(FiscalPeriod, { id: parsed.data.periodId, deletedAt: null })
      const invoices = (await tem.execute(
        `select id, organization_id, invoice_number, currency_code,
                grand_total_gross_amount::text, tax_total_amount::text
         from sales_invoices
         where id = any(?::uuid[]) and tenant_id = ?::uuid and deleted_at is null`,
        // knex passes a JS array as separate values — Postgres wants an array literal
        [`{${parsed.data.invoiceIds.join(",")}}`, tenantId],
      )) as InvoiceRow[]
      if (invoices.length !== parsed.data.invoiceIds.length) {
        throw Object.assign(new Error('One or more invoices not found'), { status: 400 })
      }

      const results: Array<{ invoiceNumber: string; journalNo: string }> = []
      const now = new Date()

      for (const invoice of invoices) {
        const already = await tem.findOne(ArInvoicePosting, { invoiceId: invoice.id, tenantId })
        if (already) {
          throw Object.assign(new Error(`Invoice ${invoice.invoice_number} is already posted`), { status: 400 })
        }
        const settings = await tem.findOne(ArSettings, { tenantId, organizationId: invoice.organization_id })
        if (!settings) {
          throw Object.assign(new Error('AR accounts are not configured (AR settings)'), { status: 400 })
        }
        const lines = buildArJournalLines(
          invoice.grand_total_gross_amount,
          invoice.tax_total_amount,
          settings.arAccountId,
          settings.revenueAccountId,
          settings.taxAccountId,
        )
        const verdict = checkPostable({
          journalStatus: 'draft',
          journalDate: parsed.data.postingDate,
          lines,
          period: period
            ? { status: period.status, startsOn: String(period.startsOn), endsOn: String(period.endsOn) }
            : null,
        })
        if (!verdict.ok) throw Object.assign(new Error(verdict.reason), { status: 400 })

        // When the customer is mapped to a party, dimension the AR lines by it.
        const link = await tem.findOne(PartyLink, {
          targetEntity: 'sales:sales_invoice_customer',
          targetId: invoice.id,
          tenantId,
          deletedAt: null,
        })

        const total = Number(invoice.grand_total_gross_amount).toFixed(4)
        const journalNo = await allocateJournalNo(tem, tenantId, invoice.organization_id)
        const journal = tem.create(GlJournal, {
          tenantId,
          organizationId: invoice.organization_id,
          journalNo,
          status: 'draft',
          journalKind: 'standard',
          periodId: parsed.data.periodId,
          journalDate: parsed.data.postingDate,
          currencyCode: invoice.currency_code,
          memo: `AR ${invoice.invoice_number}`,
          totalDebit: total,
          totalCredit: total,
          createdBy: auth.sub ?? null,
          createdAt: now,
          updatedAt: now,
        })
        tem.persist(journal)
        // Flush the header first: the uuid PK is DB-generated, so journal.id
        // is only hydrated after this flush and the lines need it for their FK.
        await tem.flush()
        lines.forEach((draft, index) => {
          tem.persist(
            tem.create(GlJournalLine, {
              tenantId,
              organizationId: invoice.organization_id,
              journalId: journal.id,
              lineNo: index + 1,
              accountId: draft.accountId,
              partyId: link?.partyId ?? null,
              debit: draft.debit,
              credit: draft.credit,
              description: `${draft.description} â€” ${invoice.invoice_number}`,
              createdAt: now,
              updatedAt: now,
            }),
          )
        })
        await tem.flush()

        journal.status = 'posted'
        journal.postedAt = now
        journal.postedBy = auth.sub ?? null
        tem.persist(
          tem.create(ArInvoicePosting, {
            tenantId,
            organizationId: invoice.organization_id,
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoice_number,
            journalId: journal.id,
            amount: total,
            postedBy: auth.sub ?? null,
            createdAt: now,
          }),
        )
        await tem.flush()
        results.push({ invoiceNumber: invoice.invoice_number, journalNo })
      }
      return results
    })
    return Response.json({ ok: true, posted })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    const message = error instanceof Error ? error.message : 'Posting failed'
    return Response.json({ ok: false, posted: [], message }, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaFinanceTag,
  summary: 'Post sales invoices to the ledger',
  methods: {
    POST: {
      summary: 'Book selected sales invoices into the GL (AR)',
      description:
        'One balanced journal per invoice (debit AR control, credit revenue and optional tax payable) plus an immutable posting record; double-posting is blocked by a unique index. All-or-nothing per batch.',
      tags: [orvaFinanceTag],
      requestBody: { schema: arPostSchema },
      responses: [{ status: 200, description: 'Posted invoices with journal numbers.', schema: resultSchema }],
      errors: [
        { status: 400, description: 'Not postable (already posted, AR accounts unset, closed period)', schema: resultSchema },
        { status: 401, description: 'Authentication required', schema: resultSchema },
      ],
    },
  },
}
