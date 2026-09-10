import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { toCsv } from '@/modules/orva_finance/lib/csv'
import { buildPnd1 } from '../../../lib/statutory'
import { loadEmployer, loadMonthRun, loadStatutoryEmployees } from '../../../lib/statutoryData'
import { orvaHrTag } from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_hr.payroll.view'] },
}

const querySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  format: z.enum(['json', 'csv']).optional().default('json'),
})

const rowSchema = z.object({
  seq: z.number(), employeeId: z.string(), employeeNo: z.string().nullable(), nationalId: z.string(),
  name: z.string(), incomeType: z.string(), payDate: z.string(), gross: z.number(), wht: z.number(),
  problems: z.array(z.string()),
})
const responseSchema = z.object({
  monthCode: z.string(),
  payDate: z.string(),
  runNo: z.string().nullable(),
  runStatus: z.string().nullable(),
  employer: z.object({
    name: z.string(), taxId: z.string().nullable(), branch: z.string().nullable(), address: z.string().nullable(),
    ssoEmployerNo: z.string().nullable(), ssoBranchCode: z.string().nullable(),
    filerName: z.string().nullable(), filerPosition: z.string().nullable(),
  }),
  rows: z.array(rowSchema),
  totals: z.object({ count: z.number(), gross: z.number(), wht: z.number() }),
  ready: z.boolean(),
})

/**
 * ภ.ง.ด.1 for one payroll month: who was paid, and how much tax was withheld
 * from each of them.
 *
 * The figures come from the payroll run, never recomputed here — the return
 * has to agree with the journal that posted it. `format=csv` returns the same
 * rows as a spreadsheet for whoever files; it is deliberately not the Revenue
 * Department's upload file (Phase I, assumption A1).
 */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'month=YYYY-MM is required' }, { status: 400 })
  const { month, format } = parsed.data
  const scope = { tenantId: auth.tenantId, organizationId }

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const data = await withTenantRls(em, scope.tenantId, async (tem) => {
    const [monthRun, employees, employer] = await Promise.all([
      loadMonthRun(tem, scope, month),
      loadStatutoryEmployees(tem, scope),
      loadEmployer(tem, scope),
    ])
    const payDate = monthRun
      ? (typeof monthRun.run.payDate === 'string' ? monthRun.run.payDate : new Date(monthRun.run.payDate as unknown as string).toISOString().slice(0, 10))
      : `${month}-01`
    const ret = buildPnd1({ monthCode: month, payDate, lines: monthRun?.lines ?? [], employees })
    return { ret, employer, runNo: monthRun?.run.runNo ?? null, runStatus: monthRun?.run.status ?? null }
  })

  if (format === 'csv') {
    const csv = toCsv(
      ['ลำดับ', 'รหัสพนักงาน', 'เลขประจำตัวประชาชน', 'ชื่อ-สกุล', 'ประเภทเงินได้', 'วันที่จ่าย', 'จำนวนเงินที่จ่าย', 'ภาษีที่หัก', 'สิ่งที่ต้องแก้'],
      data.ret.rows.map((r) => [r.seq, r.employeeNo, r.nationalId, r.name, r.incomeType, r.payDate, r.gross, r.wht, r.problems.join('; ')]),
    )
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="pnd1-${month}.csv"`,
      },
    })
  }
  return Response.json({ ...data.ret, employer: data.employer, runNo: data.runNo, runStatus: data.runStatus })
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaHrTag,
  summary: 'ภ.ง.ด.1 withholding return',
  methods: {
    GET: {
      summary: 'Per-employee income and withholding for one payroll month, as JSON or a CSV for the filer',
      tags: [orvaHrTag],
      query: querySchema,
      responses: [{ status: 200, description: 'The return.', schema: responseSchema }],
    },
  },
}
