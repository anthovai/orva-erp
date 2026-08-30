import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

/**
 * Neutral party: a person or company that can hold any number of business
 * roles (customer, vendor, employee, contact, ...). Finance and HR modules
 * reference parties instead of the CRM-flavoured customer_* / staff_* models.
 *
 * Cross-module references (to customers:customer_entity, staff members, auth
 * users) live in PartyLink as bare uuids per the framework rule banning
 * cross-module ORM relations. Within this module, real FKs are added by the
 * migration (accounting-adjacent data should not dangle).
 */
@Entity({ tableName: 'orva_parties' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class Party {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** 'person' | 'company' */
  @Property({ type: 'text' })
  kind!: string

  @Property({ name: 'display_name', type: 'text' })
  @Index()
  displayName!: string

  @Property({ name: 'legal_name', type: 'text', nullable: true })
  legalName?: string | null

  @Property({ name: 'tax_id', type: 'text', nullable: true })
  taxId?: string | null

  @Property({ type: 'text', nullable: true })
  email?: string | null

  @Property({ type: 'text', nullable: true })
  phone?: string | null

  @Property({ type: 'text', nullable: true })
  notes?: string | null

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
 * A business role a party plays. One row per (party, role); soft-deleted rows
 * free the slot (partial unique index in the migration).
 */
@Entity({ tableName: 'orva_party_roles' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class PartyRole {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'party_id', type: 'uuid' })
  @Index()
  partyId!: string

  /** 'customer' | 'vendor' | 'employee' | 'contact' | free text for verticals */
  @Property({ type: 'text' })
  role!: string

  @Property({ name: 'config_json', type: 'json', nullable: true })
  configJson?: Record<string, unknown> | null

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
 * Bridge from a party to a record owned by another module, e.g.
 * target_entity 'customers:customer_entity' + the row's uuid, or
 * 'auth:user' for the login account of an employee party.
 * A target record maps to at most one party (partial unique in migration).
 */
@Entity({ tableName: 'orva_party_links' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class PartyLink {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'party_id', type: 'uuid' })
  @Index()
  partyId!: string

  @Property({ name: 'target_entity', type: 'text' })
  targetEntity!: string

  @Property({ name: 'target_id', type: 'uuid' })
  targetId!: string

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
