import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { FiscalPeriod, GlJournal, GlJournalLine } from '@/modules/orva_finance/data/entities'
import { allocateJournalNo, checkPostable } from '@/modules/orva_finance/lib/posting'
import { StockIssue, StockSettings } from '../../data/entities'
import { postCogsSchema } from '../../data/validators'
import { buildCogsJournalLines } from '../../lib/valuation'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_stock.view'] },
  POST: { requireAuth: true, requireFeatures: ['orva_stock.manage', 'orva_finance.gl.post'] },
}

const previewSchema = z.object({
  month: z.string(),
  issues: z.number(),
  total: z.string(),
  periodStatus: z.enum(['open', 'closed', 'missing']),
  accountsConfigured: z.boolean(),
})

async function monthIssues(tem: EntityManager, tenantId: string, organizationId: string, month: string) {
  return (await tem.execute(
    `select id, quantity::text, unit_cost::text from orva_stock_issues
     where tenant_id = ?::uuid and organization_id = ?::uuid and deleted_at is null and journal_id is null
       and to_char(issued_on, 'YYYY-MM') = ?
     order by issued_on, created_at`,
    [tenantId, organizationId, month],
  )) as Array<{ id: string; quantity: string; unit_cost: string }>
}

/** What the month's COGS posting would be. */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = postCogsSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })
  const tenantId = auth.tenantId
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const result = await withTenantRls(em, tenantId, async (tem) => {
    const issues = await monthIssues(tem, tenantId, organizationId, parsed.data.month)
    const period = await tem.findOne(FiscalPeriod, { code: parsed.data.month, tenantId, organizationId, deletedAt: null })
    const settings = await tem.findOne(StockSettings, { tenantId, organizationId })
    return {
      month: parsed.data.month,
      issues: issues.length,
      total: issues.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_cost), 0).toFixed(2),
      periodStatus: period ? (period.status === 'closed' ? 'closed' : 'open') : 'missing',
      accountsConfigured: Boolean(settings?.inventoryAccountId && settings?.cogsAccountId),
    }
  })
  return Response.json(result)
}

/**
 * Posts one journal for the month's stock issues: Dr ต้นทุนขาย / Cr สินค้าคงเหลือ
 * at each issue's lot cost, and stamps the issues with the journal so a second
 * run posts nothing twice.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.sub) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = postCogsSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload' }, { status: 400 })
  const tenantId = auth.tenantId
  const userId = auth.sub
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const result = await withTenantRls(em, tenantId, async (tem) => {
      const settings = await tem.findOne(StockSettings, { tenantId, organizationId })
      if (!settings?.inventoryAccountId || !settings.cogsAccountId) throw Object.assign(new Error('ตั้งค่าบัญชีสินค้าคงเหลือและต้นทุนขายก่อน'), { status: 400 })
      const period = await tem.findOne(FiscalPeriod, { code: parsed.data.month, tenantId, organizationId, deletedAt: null })
      if (!period) throw Object.assign(new Error(`ไม่มีงวดบัญชี ${parsed.data.month}`), { status: 404 })
      if (period.status !== 'open') throw Object.assign(new Error('งวดบัญชีปิดแล้ว'), { status: 400 })
      const issues = await monthIssues(tem, tenantId, organizationId, parsed.data.month)
      if (!issues.length) return { journalNo: null, issues: 0, total: '0.00' }

      const { lines, total } = buildCogsJournalLines(issues.map((i) => ({ quantity: Number(i.quantity), unitCost: Number(i.unit_cost) })), settings.cogsAccountId, settings.inventoryAccountId)
      const endsOn = String(period.endsOn).slice(0, 10)
      const startsOn = String(period.startsOn).slice(0, 10)
      const verdict = checkPostable({ journalStatus: 'draft', journalDate: endsOn, lines, period: { status: period.status, startsOn, endsOn } })
      if (!verdict.ok) throw Object.assign(new Error(verdict.reason), { status: 400 })

      const now = new Date()
      const journalNo = await allocateJournalNo(tem, tenantId, organizationId)
      const journal = tem.create(GlJournal, {
        tenantId, organizationId, journalNo, status: 'draft', journalKind: 'standard',
        periodId: period.id, journalDate: endsOn, currencyCode: 'THB',
        memo: `ต้นทุนขายสินค้า ${parsed.data.month} (${issues.length} รายการ)`,
        totalDebit: total.toFixed(4), totalCredit: total.toFixed(4),
        createdBy: userId, createdAt: now, updatedAt: now,
      })
      tem.persist(journal)
      await tem.flush()
      lines.forEach((draft, index) => {
        tem.persist(tem.create(GlJournalLine, {
          tenantId, organizationId, journalId: journal.id, lineNo: index + 1,
          accountId: draft.accountId, partyId: null, debit: draft.debit, credit: draft.credit,
          description: draft.description, createdAt: now, updatedAt: now,
        }))
      })
      await tem.flush()
      journal.status = 'posted'
      journal.postedAt = now
      journal.postedBy = userId
      await tem.flush()
      await tem.nativeUpdate(StockIssue, { id: { $in: issues.map((i) => i.id) }, tenantId }, { journalId: journal.id, updatedAt: now })
      return { journalNo, issues: issues.length, total: total.toFixed(2) }
    })
    return Response.json({ ok: true, ...result })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json({ error: error instanceof Error ? error.message : 'COGS posting failed' }, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Stock',
  summary: 'Cost of goods sold posting',
  methods: {
    GET: { summary: 'Preview the unposted stock issues of a month', tags: ['Orva Stock'], query: postCogsSchema, responses: [{ status: 200, description: 'Preview.', schema: previewSchema }] },
    POST: { summary: 'Post Dr COGS / Cr Inventory for the month (idempotent per issue)', tags: ['Orva Stock'], requestBody: { schema: postCogsSchema }, responses: [{ status: 200, description: 'Posted.', schema: z.object({ ok: z.boolean(), journalNo: z.string().nullable(), issues: z.number(), total: z.string() }) }] },
  },
}
