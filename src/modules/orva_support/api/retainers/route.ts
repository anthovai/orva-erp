import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { SupportSubscription } from '../../data/entities'
import { retainerIssueSchema } from '../../data/validators'
import { callInternal } from '../../lib/internal'
import { retainerAmountOf, retainerVerdict, type RetainerLike } from '../../lib/retainers'
import { nextRenewal, type BillingCycle } from '../../lib/subscriptions'

const logger = createLogger('orva_support').child({ component: 'retainers' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_support.view'] },
  POST: { requireAuth: true, requireFeatures: ['orva_support.manage', 'orva_documents.manage'] },
}

const dueSchema = z.object({
  id: z.string(), name: z.string(), customerName: z.string().nullable(), quoteId: z.string().nullable(),
  renewsOn: z.string().nullable(), billingCycle: z.string(), amount: z.number(), updatedAt: z.string(),
})

const asRetainer = (row: SupportSubscription): RetainerLike => ({
  id: row.id, name: row.name, status: row.status, invoiceOnRenewal: row.invoiceOnRenewal,
  renewsOn: row.renewsOn ?? null, billingCycle: row.billingCycle as BillingCycle,
  customerEntityId: row.customerEntityId ?? null, quoteId: row.quoteId ?? null,
  retainerAmount: row.retainerAmount == null ? null : Number(row.retainerAmount),
  cost: Number(row.cost ?? 0),
  lastInvoicedOn: row.lastInvoicedAt ? row.lastInvoicedAt.toISOString().slice(0, 10) : null,
})

async function scoped(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return { error: organizationScopeRequiredResponse() }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  return { auth, em, scope: { tenantId: auth.tenantId, organizationId } }
}

/** The retainers whose cycle has come round and that have not been billed for it. */
export async function GET(req: Request) {
  const ctx = await scoped(req)
  if ('error' in ctx) return ctx.error
  const today = new URL(req.url).searchParams.get('today') ?? new Date().toISOString().slice(0, 10)
  const rows = await withTenantRls(ctx.em, ctx.scope.tenantId, (tem) =>
    tem.find(SupportSubscription, { ...ctx.scope, deletedAt: null, invoiceOnRenewal: true }))
  const items = rows.flatMap((row) => {
    const verdict = retainerVerdict(asRetainer(row), today)
    return verdict.due
      ? [{
          id: row.id, name: row.name, customerName: row.customerName ?? null, quoteId: row.quoteId ?? null,
          renewsOn: row.renewsOn ?? null, billingCycle: row.billingCycle, amount: verdict.amount,
          updatedAt: row.updatedAt.toISOString(),
        }]
      : []
  })
  return Response.json({ items, today })
}

/**
 * Issues one retainer's invoice for the current cycle and rolls the renewal
 * date on.
 *
 * The owner presses this; no worker mints invoices on its own (spec A8 — an
 * unattended invoice is a policy, not just code, and the daily scan therefore
 * only raises a notification). The invoice itself goes through the same
 * `issue-invoice` route the projects screen uses, with the caller's own
 * session, so the number series, the VAT split and the ledger posting are
 * identical to a งวด issued by hand.
 */
export async function POST(req: Request) {
  const ctx = await scoped(req)
  if ('error' in ctx) return ctx.error
  const parsed = retainerIssueSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const input = parsed.data
  const today = new Date().toISOString().slice(0, 10)

  const claimed = await withTenantRls(ctx.em, ctx.scope.tenantId, async (tem) => {
    const row = await tem.findOne(SupportSubscription, { id: input.id, ...ctx.scope, deletedAt: null })
    if (!row) return { status: 404 as const }
    if (row.updatedAt.toISOString() !== new Date(input.updatedAt).toISOString()) return { status: 409 as const }
    const verdict = retainerVerdict(asRetainer(row), today)
    if (!verdict.due) return { status: 422 as const, reason: verdict.reason }
    return { status: 200 as const, row, amount: input.amount ?? verdict.amount }
  })
  if (claimed.status === 404) return Response.json({ error: 'Not found' }, { status: 404 })
  if (claimed.status === 409) return Response.json({ error: 'Changed by someone else' }, { status: 409 })
  if (claimed.status === 422) return Response.json({ error: `ยังออกใบแจ้งหนี้ไม่ได้ (${claimed.reason})` }, { status: 422 })

  const { row, amount } = claimed
  let invoice: { id?: string; invoiceNumber?: string }
  try {
    invoice = await callInternal<{ id?: string; invoiceNumber?: string }>(req, '/api/orva_documents/issue-invoice', {
      quoteId: row.quoteId,
      amount,
      description: `ค่าดูแลระบบ ${row.name} รอบ ${row.renewsOn ?? today}`,
      dueInDays: input.dueInDays ?? 7,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn('Retainer invoice failed', { subscriptionId: row.id, err: message })
    return Response.json({ error: `ออกใบแจ้งหนี้ไม่สำเร็จ: ${message}` }, { status: 502 })
  }
  if (!invoice.id) return Response.json({ error: 'ออกใบแจ้งหนี้ไม่สำเร็จ' }, { status: 502 })

  // Only now does the cycle move on: an invoice that never happened must not
  // advance the date and hide the retainer until next month.
  const saved = await withTenantRls(ctx.em, ctx.scope.tenantId, async (tem) => {
    const fresh = await tem.findOneOrFail(SupportSubscription, { id: row.id, ...ctx.scope })
    fresh.lastInvoiceId = invoice.id ?? null
    fresh.lastInvoiceNumber = invoice.invoiceNumber ?? null
    fresh.lastInvoicedAt = new Date()
    if (fresh.renewsOn) {
      const next = nextRenewal(fresh.renewsOn, fresh.billingCycle as BillingCycle, today)
      if (next) fresh.renewsOn = next
      fresh.lastRenewedAt = new Date()
    }
    fresh.updatedAt = new Date()
    await tem.flush()
    return fresh
  })
  logger.info('Retainer invoiced', { subscriptionId: row.id, invoiceId: invoice.id, amount })
  return Response.json({
    ok: true,
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber ?? null,
    amount,
    nextRenewsOn: saved.renewsOn ?? null,
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Support',
  summary: 'Retainer invoicing',
  methods: {
    GET: { summary: 'Retainers whose cycle is due to be invoiced', tags: ['Orva Support'], responses: [{ status: 200, description: 'Due retainers.', schema: z.object({ items: z.array(dueSchema), today: z.string() }) }] },
    POST: {
      summary: "Issue this retainer's invoice for the current cycle (through issue-invoice, with the caller's session) and roll the renewal date on",
      tags: ['Orva Support'],
      requestBody: { schema: retainerIssueSchema },
      responses: [{ status: 200, description: 'Issued.', schema: z.object({ ok: z.boolean(), invoiceId: z.string(), invoiceNumber: z.string().nullable(), amount: z.number(), nextRenewsOn: z.string().nullable() }) }],
      errors: [
        { status: 409, description: 'The register row changed since it was read', schema: z.object({ error: z.string() }) },
        { status: 422, description: 'Not due, or missing customer/project/amount', schema: z.object({ error: z.string() }) },
        { status: 502, description: 'The invoice route refused', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
