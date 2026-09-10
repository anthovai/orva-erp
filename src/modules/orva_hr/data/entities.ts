import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

/**
 * Employment record. Identity lives in the installed staff registry — an
 * employee is a staff_team_member wearing a payroll hat (staffMemberId +
 * display_name snapshot). party_id remains only on legacy rows.
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

  /**
   * Legacy link into orva_party from before employees rode on the installed
   * staff registry. Kept nullable so history stays intact; new rows carry
   * staffMemberId instead and never write this.
   */
  @Property({ name: 'party_id', type: 'uuid', nullable: true })
  @Index()
  partyId?: string | null

  /**
   * The staff:staff_team_member this employment record belongs to — scalar id
   * per the no-cross-module-relations rule. One employee per member (partial
   * unique index in the migration): payroll pays a person once.
   */
  @Property({ name: 'staff_member_id', type: 'uuid', nullable: true })
  @Index()
  staffMemberId?: string | null

  /**
   * Snapshot of the person's name at link time, so payslips and GL lines are
   * readable without a cross-module join. Re-synced whenever the link is set.
   */
  @Property({ name: 'display_name', type: 'text', nullable: true })
  displayName?: string | null

  @Property({ type: 'text', nullable: true })
  position?: string | null

  @Property({ name: 'hire_date', type: 'date', nullable: true })
  hireDate?: string | null

  /** Monthly salary, THB. */
  @Property({ name: 'monthly_salary', type: 'numeric', precision: 18, scale: 4, default: '0' })
  monthlySalary: string = '0'

  /** Flat projected withholding-tax rate in percent (0-100). */
  /**
   * Legacy flat withholding rate. Unused since engine v0.2.0 — WHT is now
   * computed per run by the Rust engine's progressive Thai brackets. The
   * column stays so existing rows keep their history; no UI or API writes it.
   */
  @Property({ name: 'wht_rate', type: 'numeric', precision: 5, scale: 2, default: '0' })
  whtRate: string = '0'

  /**
   * Statutory identity, the part Thai filing needs and a display name cannot
   * carry. ภ.ง.ด.1 wants the prefix and the given/family name in separate
   * columns; สปส.1-10 wants the social-security number; 50 ทวิ prints the
   * address. `nationalId`, `ssoNumber`, `address` and `bankAccountNo` are
   * ENCRYPTED at rest (see encryption.ts) — read them through
   * findWithDecryption, never through raw SQL or the query index.
   */
  @Property({ name: 'title_th', type: 'text', nullable: true })
  titleTh?: string | null

  @Property({ name: 'first_name_th', type: 'text', nullable: true })
  firstNameTh?: string | null

  @Property({ name: 'last_name_th', type: 'text', nullable: true })
  lastNameTh?: string | null

  /** 13 digits, checksum-validated on write. */
  @Property({ name: 'national_id', type: 'text', nullable: true })
  nationalId?: string | null

  /** เลขที่บัตรประกันสังคม — usually the national id, but not always. */
  @Property({ name: 'sso_number', type: 'text', nullable: true })
  ssoNumber?: string | null

  /** Registered address as printed on the withholding certificate. */
  @Property({ type: 'text', nullable: true })
  address?: string | null

  @Property({ name: 'bank_name', type: 'text', nullable: true })
  bankName?: string | null

  @Property({ name: 'bank_account_no', type: 'text', nullable: true })
  bankAccountNo?: string | null

  /** Last day of employment; a leaver still appears in the months they were paid. */
  @Property({ name: 'termination_date', type: 'date', nullable: true })
  terminationDate?: string | null

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

  /**
   * Filing registration. The taxpayer id, branch and address on the returns
   * are the ones already printed on the tenant's tax invoices
   * (orva_documents_settings) — one place to spell the company. What lives
   * here is what only a payroll filing needs.
   */
  @Property({ name: 'sso_employer_no', type: 'text', nullable: true })
  ssoEmployerNo?: string | null

  /** สาขาที่ขึ้นทะเบียนกับสำนักงานประกันสังคม, e.g. 000000. */
  @Property({ name: 'sso_branch_code', type: 'text', nullable: true })
  ssoBranchCode?: string | null

  /** Who signs the return, and in what capacity. */
  @Property({ name: 'filer_name', type: 'text', nullable: true })
  filerName?: string | null

  @Property({ name: 'filer_position', type: 'text', nullable: true })
  filerPosition?: string | null

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
