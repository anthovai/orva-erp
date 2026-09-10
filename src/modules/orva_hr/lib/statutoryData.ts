import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { HrEmployee, HrSettings, PayrollLine, PayrollRun } from '../data/entities'
import type { CertificateMonth, Employer, StatutoryEmployee, StatutoryPayrollLine } from './statutory'

export type HrScope = { tenantId: string; organizationId: string }

/**
 * The database half of the filing screens: the pure arithmetic lives in
 * `statutory.ts`, and everything that needs a tenant lives here.
 *
 * Employees come back through `findWithDecryption` because four of their
 * columns are encrypted at rest; a raw SQL read would hand the returns
 * ciphertext where the national id belongs.
 */
export async function loadStatutoryEmployees(tem: EntityManager, scope: HrScope): Promise<StatutoryEmployee[]> {
  const rows = await findWithDecryption(
    tem, HrEmployee,
    { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    { orderBy: { employeeNo: 'asc' } },
    { tenantId: scope.tenantId },
  )
  return rows.map((row) => ({
    id: String(row.id),
    employeeNo: row.employeeNo ?? null,
    displayName: row.displayName ?? null,
    titleTh: row.titleTh ?? null,
    firstNameTh: row.firstNameTh ?? null,
    lastNameTh: row.lastNameTh ?? null,
    nationalId: row.nationalId ?? null,
    ssoNumber: row.ssoNumber ?? null,
    address: row.address ?? null,
  }))
}

const num = (value: string | number | null | undefined): number => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const toLine = (line: PayrollLine): StatutoryPayrollLine => ({
  employeeId: String(line.employeeId),
  employeeNo: line.employeeNo ?? null,
  employeeName: line.employeeName ?? null,
  gross: num(line.gross),
  ssoEmployee: num(line.ssoEmployee),
  ssoEmployer: num(line.ssoEmployer),
  wht: num(line.wht),
  net: num(line.net),
})

export type MonthRun = { run: PayrollRun; lines: StatutoryPayrollLine[] }

/**
 * The payroll month a return is filed from.
 *
 * A draft run is not a filing: nobody has been paid. A calculated run is
 * shown so the operator can check the figures before posting, and the screen
 * says which it is.
 */
export async function loadMonthRun(tem: EntityManager, scope: HrScope, monthCode: string): Promise<MonthRun | null> {
  const runs = await tem.find(
    PayrollRun,
    { tenantId: scope.tenantId, organizationId: scope.organizationId, monthCode, deletedAt: null, status: { $in: ['calculated', 'posted'] } },
    { orderBy: { createdAt: 'desc' } },
  )
  // Posted wins over calculated when a month somehow has both.
  const run = runs.find((r) => r.status === 'posted') ?? runs[0]
  if (!run) return null
  const lines = await tem.find(PayrollLine, { runId: run.id, tenantId: scope.tenantId, deletedAt: null }, { orderBy: { employeeNo: 'asc' } })
  return { run, lines: lines.map(toLine) }
}

/** Every posted month of a calendar year for one employee, for the certificate. */
export async function loadCertificateMonths(tem: EntityManager, scope: HrScope, employeeId: string, year: number): Promise<CertificateMonth[]> {
  const runs = await tem.find(
    PayrollRun,
    { tenantId: scope.tenantId, organizationId: scope.organizationId, status: 'posted', deletedAt: null, monthCode: { $like: `${year}-%` } },
    { orderBy: { monthCode: 'asc' } },
  )
  if (!runs.length) return []
  const lines = await tem.find(PayrollLine, { tenantId: scope.tenantId, employeeId, runId: { $in: runs.map((r) => r.id) }, deletedAt: null })
  const byRun = new Map(lines.map((line) => [String(line.runId), line]))
  const months: CertificateMonth[] = []
  for (const run of runs) {
    const line = byRun.get(String(run.id))
    if (!line) continue
    months.push({
      monthCode: run.monthCode,
      payDate: typeof run.payDate === 'string' ? run.payDate : new Date(run.payDate as unknown as string).toISOString().slice(0, 10),
      gross: num(line.gross),
      wht: num(line.wht),
      ssoEmployee: num(line.ssoEmployee),
    })
  }
  return months
}

type DocumentSettingsRow = { seller_name: string | null; seller_legal_name: string | null; seller_tax_id: string | null; seller_branch: string | null; seller_address: string | null }

/**
 * Who is filing. The taxpayer identity is the one already printed on the
 * tenant's tax invoices — `orva_documents_settings` — so a company is spelled
 * in one place; only the social-security registration and the signatory are
 * HR's own. Read by SQL rather than by importing the documents entity: the
 * two modules stay decoupled, and none of these columns is encrypted.
 */
export async function loadEmployer(tem: EntityManager, scope: HrScope): Promise<Employer> {
  const rows = (await tem.execute(
    `select seller_name, seller_legal_name, seller_tax_id, seller_branch, seller_address
     from orva_documents_settings
     where tenant_id = ?::uuid and organization_id = ?::uuid and deleted_at is null
     limit 1`,
    [scope.tenantId, scope.organizationId],
  )) as DocumentSettingsRow[]
  const doc = rows[0]
  const hr = await tem.findOne(HrSettings, { tenantId: scope.tenantId, organizationId: scope.organizationId })
  return {
    name: (doc?.seller_legal_name || doc?.seller_name || '').trim(),
    taxId: doc?.seller_tax_id ?? null,
    branch: doc?.seller_branch ?? null,
    address: doc?.seller_address ?? null,
    ssoEmployerNo: hr?.ssoEmployerNo ?? null,
    ssoBranchCode: hr?.ssoBranchCode ?? null,
    filerName: hr?.filerName ?? null,
    filerPosition: hr?.filerPosition ?? null,
  }
}
