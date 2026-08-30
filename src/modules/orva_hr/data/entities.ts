import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

/**
 * Employment record. Identity lives in orva_party (the party must hold an
 * active 'employee' role — validated at create); this row carries the
 * employment/compensation facts payroll needs.
 */
@Entity({ tableName: 'orva_hr_employees' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class HrEmployee {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** Allocated from orva_hr_sequences (kind 'employee'), e.g. EMP-0001. */
  @Property({ name: 'employee_no', type: 'text', nullable: true })
  employeeNo?: string | null

  @Property({ name: 'party_id', type: 'uuid' })
  @Index()
  partyId!: string

  @Property({ type: 'text', nullable: true })
  position?: string | null

  @Property({ name: 'hire_date', type: 'date', nullable: true })
  hireDate?: string | null

  /** Monthly salary, THB. */
  @Property({ name: 'monthly_salary', type: 'numeric', precision: 18, scale: 4, default: '0' })
  monthlySalary: string = '0'

  /** Flat projected withholding-tax rate in percent (0-100). */
  @Property({ name: 'wht_rate', type: 'numeric', precision: 5, scale: 2, default: '0' })
  whtRate: string = '0'

  /** 'active' | 'inactive' */
  @Property({ type: 'text', default: 'active' })
  status: string = 'active'

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * A payroll run for one month. Lifecycle: draft -> calculated -> posted.
 * Calculation is delegated to the Rust payroll engine (PAYROLL_ENGINE_URL);
 * posting books the GL journal and freezes the run (DB trigger).
 */
@Entity({ tableName: 'orva_hr_payroll_runs' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class PayrollRun {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** Allocated from orva_hr_sequences (kind 'payroll_run'), e.g. PRUN-0001. */
  @Property({ name: 'run_no', type: 'text', nullable: true })
  runNo?: string | null

  /** 'draft' | 'calculated' | 'posted' */
  @Property({ type: 'text', default: 'draft' })
  status: string = 'draft'

  /** Month label, e.g. 2026-08. */
  @Property({ name: 'month_code', type: 'text' })
  monthCode!: string

  @Property({ name: 'period_id', type: 'uuid' })
  periodId!: string

  @Property({ name: 'pay_date', type: 'date' })
  payDate!: string

  @Property({ name: 'total_gross', type: 'numeric', precision: 18, scale: 4, default: '0' })
  totalGross: string = '0'

  @Property({ name: 'total_sso_employee', type: 'numeric', precision: 18, scale: 4, default: '0' })
  totalSsoEmployee: string = '0'

  @Property({ name: 'total_sso_employer', type: 'numeric', precision: 18, scale: 4, default: '0' })
  totalSsoEmployer: string = '0'

  @Property({ name: 'total_wht', type: 'numeric', precision: 18, scale: 4, default: '0' })
  totalWht: string = '0'

  @Property({ name: 'total_net', type: 'numeric', precision: 18, scale: 4, default: '0' })
  totalNet: string = '0'

  /** Engine attribution for auditability. */
  @Property({ name: 'engine_version', type: 'text', nullable: true })
  engineVersion?: string | null

  @Property({ name: 'calculated_at', type: Date, nullable: true })
  calculatedAt?: Date | null

  @Property({ name: 'journal_id', type: 'uuid', nullable: true })
  journalId?: string | null

  @Property({ name: 'posted_at', type: Date, nullable: true })
  postedAt?: Date | null

  @Property({ name: 'posted_by', type: 'uuid', nullable: true })
  postedBy?: string | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/** Per-employee result of a payroll run, as returned by the Rust engine. */
@Entity({ tableName: 'orva_hr_payroll_lines' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class PayrollLine {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'run_id', type: 'uuid' })
  @Index()
  runId!: string

  @Property({ name: 'employee_id', type: 'uuid' })
  @Index()
  employeeId!: string

  @Property({ name: 'employee_no', type: 'text', nullable: true })
  employeeNo?: string | null

  @Property({ name: 'employee_name', type: 'text' })
  employeeName!: string

  @Property({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  gross: string = '0'

  @Property({ name: 'sso_employee', type: 'numeric', precision: 18, scale: 4, default: '0' })
  ssoEmployee: string = '0'

  @Property({ name: 'sso_employer', type: 'numeric', precision: 18, scale: 4, default: '0' })
  ssoEmployer: string = '0'

  @Property({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  wht: string = '0'

  @Property({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  net: string = '0'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * Payroll GL accounts (one row per tenant/org): where a posted run books.
 *   debit  salary expense (gross) + SSO employer expense
 *   credit SSO payable (employee+employer), tax payable (WHT), net payable
 */
@Entity({ tableName: 'orva_hr_settings' })
export class HrSettings {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'salary_expense_account_id', type: 'uuid' })
  salaryExpenseAccountId!: string

  @Property({ name: 'sso_expense_account_id', type: 'uuid' })
  ssoExpenseAccountId!: string

  @Property({ name: 'sso_payable_account_id', type: 'uuid' })
  ssoPayableAccountId!: string

  @Property({ name: 'tax_payable_account_id', type: 'uuid' })
  taxPayableAccountId!: string

  @Property({ name: 'net_payable_account_id', type: 'uuid' })
  netPayableAccountId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

/** Race-safe per-scope numbering for HR documents. */
@Entity({ tableName: 'orva_hr_sequences' })
export class HrSequence {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  kind!: string

  @Property({ name: 'next_value', type: 'bigint' })
  nextValue!: string
}
