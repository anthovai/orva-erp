import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { toCsv } from '@/modules/orva_finance/lib/csv'
import { buildSsoReturn } from '../../../lib/statutory'
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
  seq: z.number(), employeeId: z.string(), employeeNo: z.string().nullable(), ssoNumber: z.string(),
  nationalId: z.string(), name: z.string(), wage: z.number(),
  employeeContribution: z.number(), employerContribution: z.number(), problems: z.array(z.string()),
})
const responseSchema = z.object({
  monthCode: z.string(),
  runNo: z.string().nullable(),
  runStatus: z.string().nullable(),
  employer: z.object({
    name: z.string(), taxId: z.string().nullable(), branch: z.string().nullable(), address: z.string().nullable(),
    ssoEmployerNo: z.string().nullable(), ssoBranchCode: z.string().nullable(),
    filerName: z.string().nullable(), filerPosition: z.string().nullable(),
  }),
  rows: z.array(rowSchema),
  totals: z.object({ count: z.number(), wage: z.number(), employee: z.number(), employer: z.number(), total: z.number() }),
  ready: z.boolean(),
})

/**
 * สปส.1-10 for one payroll month: the wage each person was paid and the two
 * contributions remitted for them.
 *
 * Both halves are read from the payroll run rather than recomputed: the rate
 * and the ceiling live in the payroll engine, and a second implementation
 * here would be a second answer to the same question.
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
    const ret = buildSsoReturn({ monthCode: month, lines: monthRun?.lines ?? [], employees })
    return { ret, employer, runNo: monthRun?.run.runNo ?? null, runStatus: monthRun?.run.status ?? null }
  })

  if (format === 'csv') {
    const csv = toCsv(
      ['ลำดับ', 'รหัสพนักงาน', 'เลขประกันสังคม', 'เลขประจำตัวประชาชน', 'ชื่อ-สกุล', 'ค่าจ้าง', 'เงินสมทบผู้ประกันตน', 'เงินสมทบนายจ้าง', 'สิ่งที่ต้องแก้'],
      data.ret.rows.map((r) => [r.seq, r.employeeNo, r.ssoNumber, r.nationalId, r.name, r.wage, r.employeeContribution, r.employerContribution, r.problems.join('; ')]),
    )
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="sso-1-10-${month}.csv"`,
      },
    })
  }
  return Response.json({ ...data.ret, employer: data.employer, runNo: data.runNo, runStatus: data.runStatus })
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaHrTag,
  summary: 'สปส.1-10 contribution return',
  methods: {
    GET: {
      summary: 'Per-employee wage and both social-security contributions for one payroll month, as JSON or CSV',
      tags: [orvaHrTag],
      query: querySchema,
      responses: [{ status: 200, description: 'The return.', schema: responseSchema }],
    },
  },
}
