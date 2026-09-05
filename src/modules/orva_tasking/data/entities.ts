import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

/**
 * A body of work. In this business a project is normally one quotation — the
 * same thing billed in งวด — so `quoteId` links them and the Projects screen
 * can put work progress beside billing progress. Internal work leaves it null.
 *
 * Deliberately app-owned rather than read over HTTP from a separate task
 * service: keeping tasks in the same Postgres is what lets progress join to
 * billing in one query, puts task data behind the same RLS as everything else,
 * and keeps backup and restore a single procedure.
 */
@Entity({ tableName: 'orva_tasking_projects' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class TaskProject {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  /** The quotation this work is for — a bare uuid, no cross-module relation. */
  @Property({ name: 'quote_id', type: 'uuid', nullable: true })
  @Index()
  quoteId?: string | null

  /** Archived projects stay for history but leave the pickers and the counts. */
  @Property({ name: 'is_archived', type: 'boolean' })
  isArchived: boolean = false

  @Property({ type: 'int' })
  position: number = 0

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
 * One piece of work. `doneAt` is stamped rather than derived so "finished
 * last week" survives a task being reopened and closed again, which a boolean
 * alone cannot answer.
 */
@Entity({ tableName: 'orva_tasking_tasks' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class Task {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'project_id', type: 'uuid' })
  @Index()
  projectId!: string

  @Property({ type: 'text' })
  title!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ type: 'boolean' })
  done: boolean = false

  @Property({ name: 'done_at', type: Date, nullable: true })
  doneAt?: Date | null

  @Property({ name: 'due_on', type: 'date', nullable: true })
  @Index()
  dueOn?: string | null

  /** 0 none · 1 low · 2 normal · 3 high · 4 urgent */
  @Property({ type: 'int' })
  priority: number = 0

  /** Manual ordering inside a project; ties break on created_at. */
  @Property({ type: 'int' })
  position: number = 0

  /** Who it is on — a staff member id, or null while unassigned. */
  @Property({ name: 'assignee_user_id', type: 'uuid', nullable: true })
  assigneeUserId?: string | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
