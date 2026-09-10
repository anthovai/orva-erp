import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

/**
 * One piece of news sent to every consented contact. The body is Markdown;
 * the unsubscribe footer is appended per recipient at send time, never
 * stored here. `status` walks draft → sending → sent | partial | failed.
 */
@Entity({ tableName: 'orva_marketing_broadcasts' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class Broadcast {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  subject!: string

  @Property({ type: 'text' })
  body!: string

  /** draft | sending | sent | partial | failed */
  @Property({ type: 'text' })
  status: string = 'draft'

  @Property({ name: 'audience_count', type: 'integer' })
  audienceCount: number = 0

  @Property({ name: 'sent_count', type: 'integer' })
  sentCount: number = 0

  @Property({ name: 'failed_count', type: 'integer' })
  failedCount: number = 0

  @Property({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt?: Date | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: 'timestamptz', onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null
}

/**
 * The send log: one row per contact per broadcast, with the messages record
 * that carried the email or the reason nothing was sent. `email` is the
 * address at send time (the contact may change it later).
 */
@Entity({ tableName: 'orva_marketing_broadcast_recipients' })
@Index({ properties: ['tenantId', 'organizationId'] })
@Index({ properties: ['broadcastId'] })
export class BroadcastRecipient {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'broadcast_id', type: 'uuid' })
  broadcastId!: string

  /** customer_entities.id — a bare uuid, no cross-module relation. */
  @Property({ name: 'customer_entity_id', type: 'uuid' })
  customerEntityId!: string

  @Property({ name: 'display_name', type: 'text' })
  displayName!: string

  @Property({ type: 'text' })
  email!: string

  /** pending | sent | failed */
  @Property({ type: 'text' })
  status: string = 'pending'

  /** The `messages` record whose worker delivers the email. */
  @Property({ name: 'message_id', type: 'uuid', nullable: true })
  messageId?: string | null

  @Property({ type: 'text', nullable: true })
  error?: string | null

  @Property({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: 'timestamptz', onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

/**
 * The link in the email footer. One durable token per contact — the same
 * link in every broadcast, so a reader can act on an old email — and the
 * token alone names the tenant server side, so the public page carries no
 * scope. `usedAt` records the last withdrawal.
 */
@Entity({ tableName: 'orva_marketing_unsubscribe_tokens' })
@Index({ properties: ['tenantId', 'organizationId'] })
@Unique({ properties: ['token'] })
@Unique({ properties: ['tenantId', 'customerEntityId'] })
export class UnsubscribeToken {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'customer_entity_id', type: 'uuid' })
  customerEntityId!: string

  @Property({ type: 'text' })
  token!: string

  @Property({ name: 'used_at', type: 'timestamptz', nullable: true })
  usedAt?: Date | null

  @Property({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date = new Date()
}
