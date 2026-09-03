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

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
