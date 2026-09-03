import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { FaDepreciation, FiscalPeriod, FixedAsset, GlJournal, GlJournalLine } from '../../../data/entities'
import { inServiceFor, monthlyDepreciation } from '../../../lib/depreciation'
import { allocateJournalNo, checkPostable } from '../../../lib/posting'
import { depreciateSchema } from '../../../data/validators'
import { orvaFinanceTag } from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_finance.gl.view'] },
  POST: { requireAuth: true, requireFeatures: ['orva_finance.gl.post'] },
}

const runResultSchema = z.object({
  ok: z.boolean(),
  journalNo: z.string().nullable().optional(),
  assets: z.number().optional(),
  total: z.string().optional(),
  message: z.string().optional(),
})

const scheduleRowSchema = z.object({
  asset_id: z.string().uuid(),
  code: z.string().nullable(),
  name: z.string(),
  cost: z.string(),
  salvage: z.string(),
  useful_life_months: z.number(),
  months_done: z.number(),
  accumulated: z.string(),
  net_book_value: z.string(),
  next_charge: z.string(),
})

type AssetRow = {
  asset_id: string
  code: string | null
  name: string
  cost: string
  salvage: string
  useful_life_months: number
  acquired_on: string
  status: string
  accum_depr_account_id: string
  expense_account_id: string
  months_done: number
  accumulated: string
}

async function loadSchedule(tem: EntityManager, tenantId: string, organizationId: string): Promise<AssetRow[]> {
  return (await tem.execute(
    `select a.id as asset_id, a.code, a.name, a.cost::text, a.salvage::text, a.useful_life_months,
            to_char(a.acquired_on, 'YYYY-MM-DD') as acquired_on, a.status,
            a.accum_depr_account_id, a.expense_account_id,
            (select count(*)::int from orva_fa_depreciations d where d.asset_id = a.id) as months_done,
            (select coalesce(sum(d.amount), 0)::text from orva_fa_depreciations d where d.asset_id = a.id) as accumulated
     from orva_fa_assets a
     where a.tenant_id = ?::uuid and a.organization_id = ?::uuid and a.deleted_at is null
     order by a.code`,
    [tenantId, organizationId],
  )) as AssetRow[]
}

/** The register with accumulated depreciation, net book value and the next monthly charge. */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const rows = await withTenantRls(em, auth.tenantId, (tem) => loadSchedule(tem, auth.tenantId!, organizationId))
  return Response.json({
    items: rows.map((r) => {
      const next = r.status === 'active'
        ? monthlyDepreciation({ cost: r.cost, salvage: r.salvage, usefulLifeMonths: r.useful_life_months, monthsDone: r.months_done, accumulated: r.accumulated })
        : 0
      return {
        asset_id: r.asset_id, code: r.code, name: r.name, cost: r.cost, salvage: r.salvage,
        useful_life_months: r.useful_life_months, months_done: r.months_done, accumulated: Number(r.accumulated).toFixed(2),
        net_book_value: (Number(r.cost) - Number(r.accumulated)).toFixed(2), next_charge: next.toFixed(2), status: r.status,
      }
    }),
  })
}

/**
 * Books one month of straight-line depreciation for every active asset in
 * service during the period that has not been depreciated for it yet — one
 * posted journal (Dr depreciation expense / Cr accumulated depreciation per
 * asset) and one FaDepreciation row per asset, unique per period at the DB.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.sub) return Response.json({ ok: false, message: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = depreciateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ ok: false, message: 'Invalid payload' }, { status: 400 })
  const tenantId = auth.tenantId
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const result = await withTenantRls(em, tenantId, async (tem) => {
      const period = await tem.findOne(FiscalPeriod, { id: parsed.data.periodId, tenantId, deletedAt: null })
      if (!period) throw Object.assign(new Error('Period not found'), { status: 404 })
      if (period.status !== 'open') throw Object.assign(new Error('Period is closed'), { status: 400 })
      const startsOn = String(period.startsOn).slice(0, 10)
      const endsOn = String(period.endsOn).slice(0, 10)
      const postingDate = parsed.data.postingDate ?? endsOn

      const rows = await loadSchedule(tem, tenantId, organizationId)
      const done = new Set(
        ((await tem.execute(
          'select asset_id from orva_fa_depreciations where period_id = ?::uuid and tenant_id = ?::uuid',
          [period.id, tenantId],
        )) as Array<{ asset_id: string }>).map((r) => r.asset_id),
      )
      const charges: Array<{ row: AssetRow; amount: number }> = []
      for (const row of rows) {
        if (row.status !== 'active' || done.has(row.asset_id)) continue
        if (!inServiceFor(row.acquired_on, startsOn, endsOn)) continue
        const amount = monthlyDepreciation({
          cost: row.cost, salvage: row.salvage, usefulLifeMonths: row.useful_life_months,
          monthsDone: row.months_done, accumulated: row.accumulated,
        })
        if (amount > 0) charges.push({ row, amount })
      }
      if (charges.length === 0) return { journalNo: null, assets: 0, total: '0.00' }

      const lines = charges.flatMap(({ row, amount }) => [
        { accountId: row.expense_account_id, debit: amount.toFixed(4), credit: '0.0000', description: `ค่าเสื่อมราคา ${row.code ?? ''} ${row.name}`.trim() },
        { accountId: row.accum_depr_account_id, debit: '0.0000', credit: amount.toFixed(4), description: `ค่าเสื่อมราคาสะสม ${row.code ?? ''} ${row.name}`.trim() },
      ])
      const verdict = checkPostable({
        journalStatus: 'draft', journalDate: postingDate, lines,
        period: { status: period.status, startsOn, endsOn },
      })
      if (!verdict.ok) throw Object.assign(new Error(verdict.reason), { status: 400 })

      const total = charges.reduce((s, c) => s + c.amount, 0)
      const now = new Date()
      const journalNo = await allocateJournalNo(tem, tenantId, organizationId)
      const journal = tem.create(GlJournal, {
        tenantId, organizationId, journalNo, status: 'draft', journalKind: 'standard',
        periodId: period.id, journalDate: postingDate, currencyCode: 'THB',
        memo: `ค่าเสื่อมราคาประจำงวด ${period.code}`,
        totalDebit: total.toFixed(4), totalCredit: total.toFixed(4),
        createdBy: auth.sub ?? null, createdAt: now, updatedAt: now,
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
      journal.postedBy = auth.sub ?? null
      for (const { row, amount } of charges) {
        tem.persist(tem.create(FaDepreciation, {
          tenantId, organizationId, assetId: row.asset_id, periodId: period.id,
          amount: amount.toFixed(4), journalId: journal.id, createdBy: auth.sub ?? null, createdAt: now,
        }))
      }
      await tem.flush()
      return { journalNo, assets: charges.length, total: total.toFixed(2) }
    })
    return Response.json({ ok: true, ...result })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json({ ok: false, message: error instanceof Error ? error.message : 'Depreciation failed' }, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaFinanceTag,
  summary: 'Fixed-asset depreciation',
  methods: {
    GET: {
      summary: 'Depreciation schedule: accumulated, net book value, next charge per asset',
      tags: [orvaFinanceTag],
      responses: [{ status: 200, description: 'Schedule rows.', schema: z.object({ items: z.array(scheduleRowSchema.extend({ status: z.string() })) }) }],
    },
    POST: {
      summary: 'Book one month of straight-line depreciation for a period',
      tags: [orvaFinanceTag],
      requestBody: { schema: depreciateSchema },
      responses: [{ status: 200, description: 'Run result.', schema: runResultSchema }],
      errors: [
        { status: 400, description: 'Closed period or nothing postable', schema: runResultSchema },
        { status: 404, description: 'Period not found', schema: runResultSchema },
      ],
    },
  },
}

// FixedAsset is imported for the entity registry side effect of this module's graph
void FixedAsset
