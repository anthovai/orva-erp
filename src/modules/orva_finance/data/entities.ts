import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

/**
 * Chart of accounts. `code` is unique per tenant among active rows.
 * Money never lives here — accounts are pure classification.
 */
@Entity({ tableName: 'orva_gl_accounts' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class GlAccount {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  name!: string

  /** 'asset' | 'liability' | 'equity' | 'income' | 'expense' */
  @Property({ name: 'account_type', type: 'text' })
  accountType!: string

  @Property({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

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
 * Accounting period. Posting is only allowed while status = 'open';
 * a DB trigger backs this up below the application layer.
 */
@Entity({ tableName: 'orva_fiscal_periods' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class FiscalPeriod {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** e.g. '2026-08' */
  @Property({ type: 'text' })
  code!: string

  @Property({ name: 'starts_on', type: 'date' })
  startsOn!: string

  @Property({ name: 'ends_on', type: 'date' })
  endsOn!: string

  /** 'open' | 'closed' */
  @Property({ type: 'text', default: 'open' })
  status: string = 'open'

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
 * Journal entry header. Lifecycle: draft -> posted. A posted journal (and
 * its lines) is immutable — enforced by DB triggers in the migration, not
 * just by application code.
 */
@Entity({ tableName: 'orva_gl_journals' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class GlJournal {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** Allocated from orva_gl_sequences right after create, e.g. JE-000001. */
  @Property({ name: 'journal_no', type: 'text', nullable: true })
  journalNo?: string | null

  /** 'draft' | 'posted' */
  @Property({ type: 'text', default: 'draft' })
  status: string = 'draft'

  @Property({ name: 'period_id', type: 'uuid' })
  periodId!: string

  @Property({ name: 'journal_date', type: 'date' })
  journalDate!: string

  @Property({ name: 'currency_code', type: 'text', default: 'THB' })
  currencyCode: string = 'THB'

  @Property({ type: 'text', nullable: true })
  memo?: string | null

  @Property({ name: 'total_debit', type: 'numeric', precision: 18, scale: 4, default: '0' })
  totalDebit: string = '0'

  @Property({ name: 'total_credit', type: 'numeric', precision: 18, scale: 4, default: '0' })
  totalCredit: string = '0'

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

/**
 * Journal line. `partyId` is a bare uuid into orva_party (cross-module
 * references stay FK-less per the framework rule); accountId and journalId
 * are real FKs inside this module.
 */
@Entity({ tableName: 'orva_gl_journal_lines' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class GlJournalLine {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'journal_id', type: 'uuid' })
  @Index()
  journalId!: string

  @Property({ name: 'line_no', type: 'int' })
  lineNo!: number

  @Property({ name: 'account_id', type: 'uuid' })
  @Index()
  accountId!: string

  @Property({ name: 'party_id', type: 'uuid', nullable: true })
  partyId?: string | null

  @Property({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  debit: string = '0'

  @Property({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  credit: string = '0'

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * AP configuration (one row per tenant/org): which GL account is the
 * accounts-payable control account credited when a vendor bill posts.
 */
@Entity({ tableName: 'orva_ap_settings' })
export class ApSettings {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'ap_account_id', type: 'uuid' })
  apAccountId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

/**
 * Vendor bill (AP). vendor_party_id is a bare uuid into orva_party (the
 * party must hold an active 'vendor' role — validated at create). Posting a
 * bill books a GL journal (debit expense lines, credit the AP control
 * account) and freezes the bill — DB triggers mirror the journal guards.
 */
@Entity({ tableName: 'orva_ap_bills' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class ApBill {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** Allocated from orva_gl_sequences (kind 'ap_bill'), e.g. BILL-000001. */
  @Property({ name: 'bill_no', type: 'text', nullable: true })
  billNo?: string | null

  /** 'draft' | 'posted' */
  @Property({ type: 'text', default: 'draft' })
  status: string = 'draft'

  @Property({ name: 'vendor_party_id', type: 'uuid' })
  @Index()
  vendorPartyId!: string

  /** The supplier's own invoice/bill reference. */
  @Property({ name: 'vendor_bill_ref', type: 'text', nullable: true })
  vendorBillRef?: string | null

  @Property({ name: 'period_id', type: 'uuid' })
  periodId!: string

  @Property({ name: 'bill_date', type: 'date' })
  billDate!: string

  @Property({ name: 'due_date', type: 'date', nullable: true })
  dueDate?: string | null

  @Property({ name: 'currency_code', type: 'text', default: 'THB' })
  currencyCode: string = 'THB'

  @Property({ type: 'text', nullable: true })
  memo?: string | null

  @Property({ name: 'total_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  totalAmount: string = '0'

  /**
   * Sum of posted payment allocations against this bill. The only field the
   * bill guard allows to change after posting.
   */
  @Property({ name: 'paid_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  paidAmount: string = '0'

  /** GL journal booked at posting time. */
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

/**
 * Vendor payment (AP). Posting books a GL journal (debit the AP control
 * account, credit the cash/bank asset account) and adds each allocation to
 * its bill's paid_amount. Posted payments are frozen by DB triggers.
 */
@Entity({ tableName: 'orva_ap_payments' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class ApPayment {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** Allocated from orva_gl_sequences (kind 'ap_payment'), e.g. PAY-000001. */
  @Property({ name: 'payment_no', type: 'text', nullable: true })
  paymentNo?: string | null

  /** 'draft' | 'posted' */
  @Property({ type: 'text', default: 'draft' })
  status: string = 'draft'

  @Property({ name: 'vendor_party_id', type: 'uuid' })
  @Index()
  vendorPartyId!: string

  /** Asset account the payment is made from (cash/bank). */
  @Property({ name: 'cash_account_id', type: 'uuid' })
  cashAccountId!: string

  @Property({ name: 'period_id', type: 'uuid' })
  periodId!: string

  @Property({ name: 'payment_date', type: 'date' })
  paymentDate!: string

  @Property({ name: 'currency_code', type: 'text', default: 'THB' })
  currencyCode: string = 'THB'

  @Property({ type: 'text', nullable: true })
  memo?: string | null

  @Property({ name: 'total_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  totalAmount: string = '0'

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

/** How much of a payment settles which posted bill. */
@Entity({ tableName: 'orva_ap_payment_allocations' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class ApPaymentAllocation {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'payment_id', type: 'uuid' })
  @Index()
  paymentId!: string

  @Property({ name: 'bill_id', type: 'uuid' })
  @Index()
  billId!: string

  @Property({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  amount: string = '0'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/** Vendor bill expense line: which expense account, how much. */
@Entity({ tableName: 'orva_ap_bill_lines' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class ApBillLine {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'bill_id', type: 'uuid' })
  @Index()
  billId!: string

  @Property({ name: 'line_no', type: 'int' })
  lineNo!: number

  @Property({ name: 'expense_account_id', type: 'uuid' })
  expenseAccountId!: string

  @Property({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  amount: string = '0'

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * AR configuration (one row per tenant/org): which GL accounts receive
 * sales-invoice postings — AR control (asset), revenue (income), and an
 * optional tax-payable (liability) for the invoice's tax total.
 */
@Entity({ tableName: 'orva_ar_settings' })
export class ArSettings {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'ar_account_id', type: 'uuid' })
  arAccountId!: string

  @Property({ name: 'revenue_account_id', type: 'uuid' })
  revenueAccountId!: string

  @Property({ name: 'tax_account_id', type: 'uuid', nullable: true })
  taxAccountId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

/**
 * Immutable record that a sales invoice (core `sales` module, referenced by
 * bare uuid per the cross-module rule) has been booked into the GL. The
 * partial unique index makes double-posting impossible at the database.
 */
@Entity({ tableName: 'orva_ar_invoice_postings' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class ArInvoicePosting {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'invoice_id', type: 'uuid' })
  @Index()
  invoiceId!: string

  @Property({ name: 'invoice_number', type: 'text' })
  invoiceNumber!: string

  @Property({ name: 'journal_id', type: 'uuid' })
  journalId!: string

  @Property({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  amount: string = '0'

  @Property({ name: 'posted_by', type: 'uuid', nullable: true })
  postedBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

/** Race-safe per-scope document numbering (one row per tenant/org/kind). */
@Entity({ tableName: 'orva_gl_sequences' })
export class GlSequence {
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
