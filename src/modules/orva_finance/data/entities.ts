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
