/**
 * The Thai payroll paperwork, as arithmetic.
 *
 * Nothing here reads the database or renders anything: it turns one payroll
 * run's posted figures plus the employees' statutory identity into the rows of
 * ภ.ง.ด.1 (withholding return), สปส.1-10 (social-security contribution return)
 * and the annual 50 ทวิ certificate. That keeps every number testable without
 * a tenant, and keeps the routes thin.
 *
 * The outputs are a table and a spreadsheet for the person who files, not the
 * Revenue Department's or the SSO's fixed-width upload file — see assumption
 * A1 in the Phase I spec.
 */

export type StatutoryEmployee = {
  id: string
  employeeNo: string | null
  /** Snapshot name, used when the Thai name parts are not filled in. */
  displayName: string | null
  titleTh: string | null
  firstNameTh: string | null
  lastNameTh: string | null
  nationalId: string | null
  ssoNumber: string | null
  address: string | null
}

/** One line of a payroll run, as stored. */
export type StatutoryPayrollLine = {
  employeeId: string
  employeeNo: string | null
  employeeName: string | null
  gross: number
  ssoEmployee: number
  ssoEmployer: number
  wht: number
  net: number
}

export type Employer = {
  name: string
  taxId: string | null
  branch: string | null
  address: string | null
  ssoEmployerNo: string | null
  ssoBranchCode: string | null
  filerName: string | null
  filerPosition: string | null
}

/**
 * A digit string with everything else stripped. Filing forms print digits, and
 * operators type dashes and spaces.
 */
export function digitsOnly(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '')
}

/**
 * The check digit of a Thai national id.
 *
 * The first twelve digits are weighted 13 down to 2, summed, and the remainder
 * modulo 11 subtracted from 11; the last digit of that is the thirteenth. A
 * typo in a filing is worth catching at the keyboard rather than at the
 * Revenue Department, so this runs on write.
 */
export function isValidThaiNationalId(value: string | null | undefined): boolean {
  const digits = digitsOnly(value)
  if (digits.length !== 13) return false
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (13 - i)
  return (11 - (sum % 11)) % 10 === Number(digits[12])
}

/** "นาย สมชาย ใจดี", falling back to the snapshot when the parts are blank. */
export function fullNameTh(employee: Pick<StatutoryEmployee, 'titleTh' | 'firstNameTh' | 'lastNameTh' | 'displayName'>): string {
  const parts = [employee.titleTh, employee.firstNameTh, employee.lastNameTh].map((p) => (p ?? '').trim()).filter(Boolean)
  return parts.length ? parts.join(' ') : (employee.displayName ?? '').trim()
}

const round2 = (value: number) => Math.round(value * 100) / 100

export type Pnd1Row = {
  seq: number
  employeeId: string
  employeeNo: string | null
  nationalId: string
  name: string
  /** Income type per the return; salary is 40(1). */
  incomeType: string
  payDate: string
  gross: number
  wht: number
  /** What the operator still has to fix before filing, empty when ready. */
  problems: string[]
}

export type Pnd1Return = {
  monthCode: string
  payDate: string
  rows: Pnd1Row[]
  totals: { count: number; gross: number; wht: number }
  /** True when every row is filable. */
  ready: boolean
}

/**
 * ภ.ง.ด.1 — what was paid to each employee this month and what was withheld.
 * A missing or malformed national id does not drop the row: the person WAS
 * paid, and hiding them would make the total disagree with the ledger. The row
 * carries the problem instead, and the return reports itself as not ready.
 */
export function buildPnd1(args: {
  monthCode: string
  payDate: string
  lines: StatutoryPayrollLine[]
  employees: StatutoryEmployee[]
}): Pnd1Return {
  const byId = new Map(args.employees.map((e) => [e.id, e]))
  const rows: Pnd1Row[] = args.lines.map((line, index) => {
    const employee = byId.get(line.employeeId)
    const nationalId = digitsOnly(employee?.nationalId)
    const name = employee ? fullNameTh(employee) : (line.employeeName ?? '')
    const problems: string[] = []
    if (!nationalId) problems.push('ยังไม่ได้กรอกเลขบัตรประชาชน')
    else if (!isValidThaiNationalId(nationalId)) problems.push('เลขบัตรประชาชนไม่ถูกต้อง')
    if (!name.trim()) problems.push('ยังไม่ได้กรอกชื่อ-สกุล')
    return {
      seq: index + 1,
      employeeId: line.employeeId,
      employeeNo: line.employeeNo ?? employee?.employeeNo ?? null,
      nationalId,
      name,
      incomeType: '40(1)',
      payDate: args.payDate,
      gross: round2(line.gross),
      wht: round2(line.wht),
      problems,
    }
  })
  return {
    monthCode: args.monthCode,
    payDate: args.payDate,
    rows,
    totals: {
      count: rows.length,
      gross: round2(rows.reduce((sum, r) => sum + r.gross, 0)),
      wht: round2(rows.reduce((sum, r) => sum + r.wht, 0)),
    },
    ready: rows.length > 0 && rows.every((r) => r.problems.length === 0),
  }
}

export type SsoRow = {
  seq: number
  employeeId: string
  employeeNo: string | null
  ssoNumber: string
  nationalId: string
  name: string
  /** Actual wage paid; the contribution is computed on the capped base. */
  wage: number
  employeeContribution: number
  employerContribution: number
  problems: string[]
}

export type SsoReturn = {
  monthCode: string
  rows: SsoRow[]
  totals: { count: number; wage: number; employee: number; employer: number; total: number }
  ready: boolean
}

/**
 * สปส.1-10 — the monthly contribution return. The employee and employer halves
 * come from the payroll run rather than being recomputed here: the engine is
 * the one place the rate and the ceiling live, and a second implementation
 * would be a second answer.
 */
export function buildSsoReturn(args: {
  monthCode: string
  lines: StatutoryPayrollLine[]
  employees: StatutoryEmployee[]
}): SsoReturn {
  const byId = new Map(args.employees.map((e) => [e.id, e]))
  const rows: SsoRow[] = args.lines.map((line, index) => {
    const employee = byId.get(line.employeeId)
    // The social-security number defaults to the national id, which is what it
    // is for most Thai employees; an explicit number wins when there is one.
    const ssoNumber = digitsOnly(employee?.ssoNumber) || digitsOnly(employee?.nationalId)
    const nationalId = digitsOnly(employee?.nationalId)
    const name = employee ? fullNameTh(employee) : (line.employeeName ?? '')
    const problems: string[] = []
    if (!ssoNumber) problems.push('ยังไม่ได้กรอกเลขประกันสังคมหรือเลขบัตรประชาชน')
    if (!name.trim()) problems.push('ยังไม่ได้กรอกชื่อ-สกุล')
    return {
      seq: index + 1,
      employeeId: line.employeeId,
      employeeNo: line.employeeNo ?? employee?.employeeNo ?? null,
      ssoNumber,
      nationalId,
      name,
      wage: round2(line.gross),
      employeeContribution: round2(line.ssoEmployee),
      employerContribution: round2(line.ssoEmployer),
      problems,
    }
  })
  const employee = round2(rows.reduce((sum, r) => sum + r.employeeContribution, 0))
  const employer = round2(rows.reduce((sum, r) => sum + r.employerContribution, 0))
  return {
    monthCode: args.monthCode,
    rows,
    totals: {
      count: rows.length,
      wage: round2(rows.reduce((sum, r) => sum + r.wage, 0)),
      employee,
      employer,
      total: round2(employee + employer),
    },
    ready: rows.length > 0 && rows.every((r) => r.problems.length === 0),
  }
}

export type CertificateMonth = { monthCode: string; payDate: string; gross: number; wht: number; ssoEmployee: number }

export type EmployeeCertificate = {
  year: number
  employee: { id: string; employeeNo: string | null; name: string; nationalId: string; address: string | null }
  months: CertificateMonth[]
  totals: { gross: number; wht: number; ssoEmployee: number }
  problems: string[]
}

/**
 * The figures behind one employee's 50 ทวิ for a calendar year: every month
 * they were paid, and the year's totals. Only posted months count — a
 * certificate states tax actually remitted.
 */
export function buildEmployeeCertificate(args: {
  year: number
  employee: StatutoryEmployee
  months: CertificateMonth[]
}): EmployeeCertificate {
  const months = [...args.months].sort((a, b) => a.monthCode.localeCompare(b.monthCode))
  const nationalId = digitsOnly(args.employee.nationalId)
  const name = fullNameTh(args.employee)
  const problems: string[] = []
  if (!nationalId) problems.push('ยังไม่ได้กรอกเลขบัตรประชาชน')
  else if (!isValidThaiNationalId(nationalId)) problems.push('เลขบัตรประชาชนไม่ถูกต้อง')
  if (!name.trim()) problems.push('ยังไม่ได้กรอกชื่อ-สกุล')
  if (!months.length) problems.push('ปีนี้ยังไม่มีรอบเงินเดือนที่ลงบัญชีแล้ว')
  return {
    year: args.year,
    employee: {
      id: args.employee.id,
      employeeNo: args.employee.employeeNo,
      name,
      nationalId,
      address: args.employee.address,
    },
    months,
    totals: {
      gross: round2(months.reduce((sum, m) => sum + m.gross, 0)),
      wht: round2(months.reduce((sum, m) => sum + m.wht, 0)),
      ssoEmployee: round2(months.reduce((sum, m) => sum + m.ssoEmployee, 0)),
    },
    problems,
  }
}
