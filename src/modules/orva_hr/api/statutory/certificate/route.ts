import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { buildEmployeeCertificate } from '../../../lib/statutory'
import { loadCertificateMonths, loadEmployer, loadStatutoryEmployees } from '../../../lib/statutoryData'
import { orvaHrTag } from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_hr.payroll.view'] },
}

const querySchema = z.object({
  employeeId: z.string().uuid(),
  year: z.coerce.number().int().min(2000).max(2200),
})

const responseSchema = z.object({
  year: z.number(),
  employer: z.object({
    name: z.string(), taxId: z.string().nullable(), branch: z.string().nullable(), address: z.string().nullable(),
    ssoEmployerNo: z.string().nullable(), ssoBranchCode: z.string().nullable(),
    filerName: z.string().nullable(), filerPosition: z.string().nullable(),
  }),
  employee: z.object({ id: z.string(), employeeNo: z.string().nullable(), name: z.string(), nationalId: z.string(), address: z.string().nullable() }),
  months: z.array(z.object({ monthCode: z.string(), payDate: z.string(), gross: z.number(), wht: z.number(), ssoEmployee: z.number() })),
  totals: z.object({ gross: z.number(), wht: z.number(), ssoEmployee: z.number() }),
  problems: z.array(z.string()),
})

/**
 * The figures for one employee's หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ)
 * over a calendar year: every posted month, the year's income and the tax
 * withheld. Only posted runs count — the certificate states tax that was
 * actually remitted, not tax a draft says would be.
 */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'employeeId and year are required' }, { status: 400 })
  const { employeeId, year } = parsed.data
  const scope = { tenantId: auth.tenantId, organizationId }

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const data = await withTenantRls(em, scope.tenantId, async (tem) => {
    const employees = await loadStatutoryEmployees(tem, scope)
    const employee = employees.find((e) => e.id === employeeId)
    if (!employee) return null
    const [months, employer] = await Promise.all([
      loadCertificateMonths(tem, scope, employeeId, year),
      loadEmployer(tem, scope),
    ])
    return { cert: buildEmployeeCertificate({ year, employee, months }), employer }
  })
  if (!data) return Response.json({ error: 'Employee not found' }, { status: 404 })
  return Response.json({ ...data.cert, employer: data.employer })
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaHrTag,
  summary: '50 ทวิ certificate figures (employee)',
  methods: {
    GET: {
      summary: "One employee's annual income and withholding for the section 50 bis certificate, from posted payroll months only",
      tags: [orvaHrTag],
      query: querySchema,
      responses: [{ status: 200, description: 'Certificate figures.', schema: responseSchema }],
      errors: [{ status: 404, description: 'Employee not found', schema: z.object({ error: z.string() }) }],
    },
  },
}
