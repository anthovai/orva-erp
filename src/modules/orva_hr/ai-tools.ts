/**
 * AI tool pack for @orva/hr — read-only employee and payroll tools consumed
 * by the Orva Finance Assistant (orva_finance/ai-agents.ts).
 *
 * Same local-definition pattern as orva_finance/ai-tools.ts: tenant + org
 * scoped, reads inside withTenantRls, bounded serializable output, no
 * mutations (calculating/posting payroll stays in the backoffice UI).
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'

export interface OrvaHrToolContext {
  tenantId: string | null
  organizationId: string | null
  userId: string | null
  container: AwilixContainer
  userFeatures: string[]
  isSuperAdmin: boolean
}

export interface OrvaHrAiToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string
  displayName?: string
  description: string
  inputSchema: z.ZodType<TInput>
  requiredFeatures?: string[]
  tags?: string[]
  isMutation?: boolean
  handler: (input: TInput, context: OrvaHrToolContext) => Promise<TOutput>
}

function requireScope(ctx: OrvaHrToolContext): { tenantId: string; organizationId: string | null } {
  if (!ctx.tenantId) throw new Error('Tenant context is required for orva_hr.* tools')
  return { tenantId: ctx.tenantId, organizationId: ctx.organizationId }
}

function resolveEm(ctx: OrvaHrToolContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em')
}

// ── orva_hr.list_employees ──────────────────────────────────────────────────

const listEmployeesInput = z.object({
  q: z.string().max(100).optional().describe('Filter by employee number, name, or position (case-insensitive substring).'),
  status: z.enum(['active', 'inactive']).optional(),
}).passthrough()

const listEmployeesTool: OrvaHrAiToolDefinition = {
  name: 'orva_hr.list_employees',
  displayName: 'List employees',
  description: 'List employees (number, name snapshotted from the staff registry, position, hire date, monthly salary, status). Withholding tax is computed per run by the payroll engine (progressive Thai brackets).',
  inputSchema: listEmployeesInput,
  requiredFeatures: ['orva_hr.employees.view'],
  tags: ['read', 'orva_hr'],
  handler: async (rawInput, ctx) => {
    const { tenantId, organizationId } = requireScope(ctx)
    const input = listEmployeesInput.parse(rawInput)
    const em = resolveEm(ctx)
    const rows = await withTenantRls(em, tenantId, async (tem) =>
      (await tem.execute(
        `select e.id, e.employee_no, e.display_name, e.position,
                to_char(e.hire_date, 'YYYY-MM-DD') as hire_date,
                e.monthly_salary::text as monthly_salary, e.status
         from orva_hr_employees e
         where e.deleted_at is null
           and e.tenant_id = ?::uuid
           and (?::uuid is null or e.organization_id = ?::uuid)
           and (?::text is null or e.status = ?::text)
           and (?::text is null
                or e.employee_no ilike '%' || ?::text || '%'
                or p.display_name ilike '%' || ?::text || '%'
                or e.position ilike '%' || ?::text || '%')
         order by e.employee_no nulls last, e.created_at
         limit 200`,
        [
          tenantId,
          organizationId ?? null, organizationId ?? null,
          input.status ?? null, input.status ?? null,
          input.q ?? null, input.q ?? null, input.q ?? null, input.q ?? null,
        ],
      )) as Array<Record<string, unknown>>,
    )
    return {
      employees: rows.map((row) => ({
        id: String(row.id),
        employeeNo: (row.employee_no as string | null) ?? null,
        name: (row.display_name as string | null) ?? null,
        position: (row.position as string | null) ?? null,
        hireDate: (row.hire_date as string | null) ?? null,
        monthlySalary: String(row.monthly_salary),
        status: String(row.status),
        href: '/backend/hr/employees',
      })),
    }
  },
}

// ── orva_hr.list_payroll_runs ───────────────────────────────────────────────

const listPayrollRunsInput = z.object({
  status: z.enum(['draft', 'calculated', 'posted']).optional(),
  limit: z.number().int().min(1).max(50).optional().describe('Max rows, default 12.'),
}).passthrough()

const listPayrollRunsTool: OrvaHrAiToolDefinition = {
  name: 'orva_hr.list_payroll_runs',
  displayName: 'List payroll runs',
  description: 'List payroll runs (number, month, pay date, status, totals: gross, SSO employee/employer, WHT, net) newest first.',
  inputSchema: listPayrollRunsInput,
  requiredFeatures: ['orva_hr.payroll.view'],
  tags: ['read', 'orva_hr'],
  handler: async (rawInput, ctx) => {
    const { tenantId, organizationId } = requireScope(ctx)
    const input = listPayrollRunsInput.parse(rawInput)
    const em = resolveEm(ctx)
    const rows = await withTenantRls(em, tenantId, async (tem) =>
      (await tem.execute(
        `select id, run_no, month_code, to_char(pay_date, 'YYYY-MM-DD') as pay_date, status,
                total_gross::text as total_gross,
                total_sso_employee::text as total_sso_employee,
                total_sso_employer::text as total_sso_employer,
                total_wht::text as total_wht,
                total_net::text as total_net
         from orva_hr_payroll_runs
         where deleted_at is null
           and tenant_id = ?::uuid
           and (?::uuid is null or organization_id = ?::uuid)
           and (?::text is null or status = ?::text)
         order by month_code desc, created_at desc
         limit ?`,
        [
          tenantId,
          organizationId ?? null, organizationId ?? null,
          input.status ?? null, input.status ?? null,
          input.limit ?? 12,
        ],
      )) as Array<Record<string, unknown>>,
    )
    return {
      payrollRuns: rows.map((row) => ({
        id: String(row.id),
        runNo: (row.run_no as string | null) ?? null,
        monthCode: String(row.month_code),
        payDate: String(row.pay_date),
        status: String(row.status),
        totalGross: String(row.total_gross),
        totalSsoEmployee: String(row.total_sso_employee),
        totalSsoEmployer: String(row.total_sso_employer),
        totalWht: String(row.total_wht),
        totalNet: String(row.total_net),
        href: `/backend/hr/payroll/${String(row.id)}`,
      })),
    }
  },
}

// ── orva_hr.get_payroll_run ─────────────────────────────────────────────────

const getPayrollRunInput = z.object({
  runId: z.string().uuid().describe('Payroll run id from orva_hr.list_payroll_runs.'),
}).passthrough()

const getPayrollRunTool: OrvaHrAiToolDefinition = {
  name: 'orva_hr.get_payroll_run',
  displayName: 'Get payroll run detail',
  description: 'Return one payroll run with its per-employee lines (gross, SSO employee/employer, WHT, net).',
  inputSchema: getPayrollRunInput,
  requiredFeatures: ['orva_hr.payroll.view'],
  tags: ['read', 'orva_hr'],
  handler: async (rawInput, ctx) => {
    const { tenantId, organizationId } = requireScope(ctx)
    const input = getPayrollRunInput.parse(rawInput)
    const em = resolveEm(ctx)
    const { run, lines } = await withTenantRls(em, tenantId, async (tem) => {
      const runs = (await tem.execute(
        `select id, run_no, month_code, to_char(pay_date, 'YYYY-MM-DD') as pay_date, status,
                total_gross::text as total_gross, total_wht::text as total_wht,
                total_sso_employee::text as total_sso_employee,
                total_sso_employer::text as total_sso_employer,
                total_net::text as total_net, engine_version
         from orva_hr_payroll_runs
         where id = ?::uuid and deleted_at is null
           and tenant_id = ?::uuid
           and (?::uuid is null or organization_id = ?::uuid)`,
        [input.runId, tenantId, organizationId ?? null, organizationId ?? null],
      )) as Array<Record<string, unknown>>
      const lineRows = runs.length
        ? ((await tem.execute(
            `select employee_no, employee_name, gross::text as gross,
                    sso_employee::text as sso_employee, sso_employer::text as sso_employer,
                    wht::text as wht, net::text as net
             from orva_hr_payroll_lines
             where run_id = ?::uuid and deleted_at is null
             order by employee_no nulls last
             limit 500`,
            [input.runId],
          )) as Array<Record<string, unknown>>)
        : []
      return { run: runs[0] ?? null, lines: lineRows }
    })
    if (!run) return { found: false as const }
    return {
      found: true as const,
      run: {
        id: String(run.id),
        runNo: (run.run_no as string | null) ?? null,
        monthCode: String(run.month_code),
        payDate: String(run.pay_date),
        status: String(run.status),
        totalGross: String(run.total_gross),
        totalSsoEmployee: String(run.total_sso_employee),
        totalSsoEmployer: String(run.total_sso_employer),
        totalWht: String(run.total_wht),
        totalNet: String(run.total_net),
        engineVersion: (run.engine_version as string | null) ?? null,
        href: `/backend/hr/payroll/${String(run.id)}`,
      },
      lines: lines.map((row) => ({
        employeeNo: (row.employee_no as string | null) ?? null,
        employeeName: String(row.employee_name),
        gross: String(row.gross),
        ssoEmployee: String(row.sso_employee),
        ssoEmployer: String(row.sso_employer),
        wht: String(row.wht),
        net: String(row.net),
      })),
    }
  },
}

export const aiTools: OrvaHrAiToolDefinition[] = [
  listEmployeesTool,
  listPayrollRunsTool,
  getPayrollRunTool,
]

export default aiTools
