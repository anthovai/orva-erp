import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

/**
 * One OIDC identity-provider connection per tenant/org, matched at login by
 * the user's email domain. `clientSecret` is encrypted at rest via the
 * module encryption map (encryption.ts).
 */
@Entity({ tableName: 'orva_sso_connections' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class SsoConnection {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  name!: string

  /** OIDC issuer base URL — discovery lives at <issuer>/.well-known/openid-configuration. */
  @Property({ name: 'issuer_url', type: 'text' })
  issuerUrl!: string

  @Property({ name: 'client_id', type: 'text' })
  clientId!: string

  @Property({ name: 'client_secret', type: 'text' })
  clientSecret!: string

  /** Comma-separated lowercase email domains this connection claims (e.g. "acme.co.th,acme.com"). */
  @Property({ name: 'email_domains', type: 'text' })
  emailDomains!: string

  @Property({ type: 'boolean', default: true })
  enabled: boolean = true

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
