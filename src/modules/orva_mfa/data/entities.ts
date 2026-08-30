import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

/**
 * One TOTP authenticator per user (partial-unique on active rows).
 * `secret` is encrypted at rest via the module encryption map
 * (encryption.ts) — read it only through findOneWithDecryption.
 */
@Entity({ tableName: 'orva_mfa_totp_credentials' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class TotpCredential {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'user_id', type: 'uuid' })
  @Index()
  userId!: string

  /** Base32 TOTP secret — encrypted at rest, shown to the user once at enroll. */
  @Property({ type: 'text' })
  secret!: string

  /** 'pending' until the user confirms a first valid code, then 'active'. */
  @Property({ type: 'text', default: 'pending' })
  status: string = 'pending'

  @Property({ type: 'text', nullable: true })
  label?: string | null

  /** Last accepted TOTP time-step — a step is consumed once (replay guard). */
  @Property({ name: 'last_used_step', type: 'bigint', nullable: true })
  lastUsedStep?: string | null

  @Property({ name: 'failed_attempts', type: 'int', default: 0 })
  failedAttempts: number = 0

  @Property({ name: 'locked_until', type: Date, nullable: true })
  lockedUntil?: Date | null

  @Property({ name: 'activated_at', type: Date, nullable: true })
  activatedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * Single-use recovery codes, stored only as hashes (core hashAuthToken).
 * Regenerating a batch soft-deletes the previous one.
 */
@Entity({ tableName: 'orva_mfa_recovery_codes' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class RecoveryCode {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'user_id', type: 'uuid' })
  @Index()
  userId!: string

  @Property({ name: 'code_hash', type: 'text' })
  codeHash!: string

  @Property({ name: 'used_at', type: Date, nullable: true })
  usedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * "This session passed the MFA challenge." Keyed by the auth session id, so
 * the backend page middleware can trust refreshed tokens whose JWT lost the
 * custom `mfa` claim: same session row → same sid → flag still holds.
 */
@Entity({ tableName: 'orva_mfa_session_flags' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class SessionFlag {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'user_id', type: 'uuid' })
  @Index()
  userId!: string

  @Property({ name: 'session_id', type: 'uuid', unique: true })
  sessionId!: string

  @Property({ name: 'verified_at', type: Date })
  verifiedAt!: Date

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
