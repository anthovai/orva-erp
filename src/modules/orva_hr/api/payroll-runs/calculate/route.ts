import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { Party } from '@/modules/orva_party/data/entities'
import { HrEmployee, PayrollLine, PayrollRun } from '../../../data/entities'
import { callPayrollEngine } from '../../../lib/payroll'
import { payrollActionSchema } from '../../../data/validators'
import { orvaHrTag } from '../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['orva_hr.payroll.manage'] },
}

const responseSchema = z.object({
  ok: z.boolean(),
  employees: z.number().optional(),
  totalGross: z.string().optional(),
  totalNet: z.string().optional(),
  engineVersion: z.string().optional(),
  message: z.string().optional(),
})

/**
 * Calculates a payroll run by delegating to the Rust payroll engine
 * (services/payroll-engine). Replaces any previous lines and moves the run
 * to 'calculated'. Recalculation is allowed until the run is posted.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.sub) {
    return Response.json({ ok: false, message: 'Unauthorized' }, { status: 401 })
  }
  const parsed = payrollActionSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ ok: false, message: 'Invalid payload' }, { status: 400 })
  const tenantId = auth.tenantId
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const summary = await withTenantRls(em, tenantId, async (tem) => {
      const run = await tem.findOne(PayrollRun, { id: parsed.data.id, deletedAt: null })
      if (!run) throw Object.assign(new Error('Payroll run not found'), { status: 404 })
      if (run.status === 'posted') throw Object.assign(new Error('Posted runs cannot be recalculated'), { status: 400 })

      const employees = await tem.find(HrEmployee, {
        tenantId,
        organizationId: run.organizationId,
        status: 'active',
        deletedAt: null,
      })
      if (employees.length === 0) throw Object.assign(new Error('No active employees to calculate'), { status: 400 })

      const { result, engineVersion } = await callPayrollEngine(
        employees.map((employee) => ({
          id: employee.id,
          salary: Number(employee.monthlySalary),
        })),
      )

      // Party display names for the stored lines.
      const parties = await tem.find(Party, { id: { $in: employees.map((e) => e.partyId) } })
      const nameByParty = new Map(parties.map((party) => [party.id, party.displayName]))
      const byEmployee = new Map(employees.map((employee) => [employee.id, employee]))

      const previous = await tem.find(PayrollLine, { runId: run.id })
      previous.forEach((line) => tem.remove(line))

      const now = new Date()
      for (const line of result.lines) {
        const employee = byEmployee.get(line.id)
        if (!employee) continue
        tem.persist(
          tem.create(PayrollLine, {
            tenantId,
            organizationId: String(run.organizationId),
            runId: String(run.id),
            employeeId: employee.id,
            employeeNo: employee.employeeNo ?? null,
            employeeName: nameByParty.get(employee.partyId) ?? employee.employeeNo ?? employee.id,
            gross: line.gross.toFixed(4),
            ssoEmployee: line.ssoEmployee.toFixed(4),
            ssoEmployer: line.ssoEmployer.toFixed(4),
            wht: line.wht.toFixed(4),
            net: line.net.toFixed(4),
            createdAt: now,
            updatedAt: now,
          }),
        )
      }
      run.status = 'calculated'
      run.totalGross = result.totals.gross.toFixed(4)
      run.totalSsoEmployee = result.totals.ssoEmployee.toFixed(4)
      run.totalSsoEmployer = result.totals.ssoEmployer.toFixed(4)
      run.totalWht = result.totals.wht.toFixed(4)
      run.totalNet = result.totals.net.toFixed(4)
      run.engineVersion = engineVersion
      run.calculatedAt = now
      await tem.flush()
      return {
        employees: result.lines.length,
        totalGross: run.totalGross,
        totalNet: run.totalNet,
        engineVersion,
      }
    })
    return Response.json({ ok: true, ...summary })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    const message = error instanceof Error ? error.message : 'Calculation failed'
    return Response.json({ ok: false, message }, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaHrTag,
  summary: 'Calculate a payroll run',
  methods: {
    POST: {
      summary: 'Calculate payroll via the Rust engine',
      description: 'Sends active employees to the payroll engine (Thai SSO + WHT), stores per-employee lines, and moves the run to calculated.',
      tags: [orvaHrTag],
      requestBody: { schema: payrollActionSchema },
      responses: [{ status: 200, description: 'Calculated totals.', schema: responseSchema }],
      errors: [
        { status: 400, description: 'No employees / engine rejected input / run posted', schema: responseSchema },
        { status: 401, description: 'Authentication required', schema: responseSchema },
        { status: 503, description: 'Payroll engine unreachable', schema: responseSchema },
      ],
    },
  },
}
