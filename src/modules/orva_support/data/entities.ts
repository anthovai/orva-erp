import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

/**
 * A support ticket raised against software we shipped. `customerEntityId` is a
 * bare uuid into the installed CRM (customer_entities) and `quoteId` an
 * optional link to the project it belongs to — cross-module references stay
 * FK-less per the framework rule.
 *
 * Statuses follow the owner's actual handling, not a helpdesk product's:
 *   open → in_progress → waiting_customer → resolved → closed
 * `firstResponseAt` / `resolvedAt` make response and resolution time
 * measurable without an SLA engine.
 */
@Entity({ tableName: 'orva_support_tickets' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class SupportTicket {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** TCK-000001, allocated from orva_gl_sequences kind 'support_ticket'. */
  @Property({ name: 'ticket_no', type: 'text' })
  ticketNo!: string

  @Property({ type: 'text' })
  subject!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  /** bug | question | change_request | incident */
  @Property({ type: 'text' })
  kind: string = 'bug'

  /** low | normal | high | urgent */
  @Property({ type: 'text' })
  priority: string = 'normal'

  /** open | in_progress | waiting_customer | resolved | closed */
  @Property({ type: 'text' })
  status: string = 'open'

  @Property({ name: 'customer_entity_id', type: 'uuid', nullable: true })
  @Index()
  customerEntityId?: string | null

  /** Denormalised so a list row needs no decryption round trip. */
  @Property({ name: 'customer_name', type: 'text', nullable: true })
  customerName?: string | null

  @Property({ name: 'contact_email', type: 'text', nullable: true })
  contactEmail?: string | null

  /** manual | email — how the ticket arrived. */
  @Property({ type: 'text' })
  source: string = 'manual'

  /** Mail thread this belongs to, so a reply lands on the same conversation. */
  @Property({ name: 'thread_id', type: 'text', nullable: true })
  @Index()
  threadId?: string | null

  /** The inbox_emails row that opened it — unique, so a redelivery cannot
   *  open a second ticket for the same email. */
  @Property({ name: 'source_email_id', type: 'uuid', nullable: true })
  sourceEmailId?: string | null
  /** The quotation/project this ticket belongs to, when it is contract work. */
  @Property({ name: 'quote_id', type: 'uuid', nullable: true })
  quoteId?: string | null

  @Property({ name: 'due_on', type: 'date', nullable: true })
  dueOn?: string | null

  /** Minutes spent, summed from replies — the basis for billable support. */
  @Property({ name: 'minutes_spent', type: 'int' })
  minutesSpent: number = 0

  @Property({ name: 'first_response_at', type: Date, nullable: true })
  firstResponseAt?: Date | null

  @Property({ name: 'resolved_at', type: Date, nullable: true })
  resolvedAt?: Date | null

  @Property({ name: 'closed_at', type: Date, nullable: true })
  closedAt?: Date | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/** One entry in a ticket's thread: our reply, the customer's word, or a note. */
@Entity({ tableName: 'orva_support_replies' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class SupportReply {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'ticket_id', type: 'uuid' })
  @Index()
  ticketId!: string

  /** staff | customer | note */
  @Property({ type: 'text' })
  author: string = 'staff'

  @Property({ type: 'text' })
  body!: string

  @Property({ name: 'minutes_spent', type: 'int' })
  minutesSpent: number = 0

  /** The `messages` record that carried this reply to the client by email, when one did. */
  @Property({ name: 'email_message_id', type: 'uuid', nullable: true })
  emailMessageId?: string | null

  /** null = not emailed · 'sent' · 'failed' (see emailError) */
  @Property({ name: 'email_status', type: 'text', nullable: true })
  emailStatus?: string | null

  @Property({ name: 'email_error', type: 'text', nullable: true })
  emailError?: string | null

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
 * A software licence, domain, hosting plan or certificate we pay for. The
 * register exists for one reason: renewals that lapse unnoticed take a
 * client's site with them. `renewsOn` drives the home-screen warning,
 * `billingCycle` rolls it forward once paid, and `customerEntityId` /
 * `quoteId` say whose project a licence is held for — bare uuids, no
 * cross-module relation.
 */
@Entity({ tableName: 'orva_support_subscriptions' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class SupportSubscription {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  name!: string

  /** Who bills us — GitHub, Cloudflare, the registrar. */
  @Property({ type: 'text', nullable: true })
  vendor?: string | null

  /** software | domain | hosting | certificate | other */
  @Property({ type: 'text' })
  kind: string = 'software'

  @Property({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  cost: string = '0.0000'

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode: string = 'THB'

  /** monthly | quarterly | yearly | one_time */
  @Property({ name: 'billing_cycle', type: 'text' })
  billingCycle: string = 'yearly'

  /** The next date money leaves or the licence dies. Null for a one-off. */
  @Property({ name: 'renews_on', type: 'date', nullable: true })
  @Index()
  renewsOn?: string | null

  /** False means somebody must go and pay it by hand. */
  @Property({ name: 'auto_renew', type: 'boolean' })
  autoRenew: boolean = true

  /** Expense account this posts to when the bill arrives (5700 family). */
  @Property({ name: 'expense_account_code', type: 'text', nullable: true })
  expenseAccountCode?: string | null

  @Property({ name: 'customer_entity_id', type: 'uuid', nullable: true })
  customerEntityId?: string | null

  @Property({ name: 'customer_name', type: 'text', nullable: true })
  customerName?: string | null

  /** The project this licence serves, when it is held for contract work. */
  @Property({ name: 'quote_id', type: 'uuid', nullable: true })
  quoteId?: string | null

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  /** active | cancelled */
  @Property({ type: 'text' })
  status: string = 'active'

  /** Stamped every time the renewal date is rolled forward. */
  @Property({ name: 'last_renewed_at', type: Date, nullable: true })
  lastRenewedAt?: Date | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
