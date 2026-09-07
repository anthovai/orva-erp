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

  /**
   * When the work starts and ends. Both optional, but a task needs both before
   * it can appear on a timeline — a single date is a deadline, not a duration.
   */
  @Property({ name: 'start_date', type: 'date', nullable: true })
  @Index()
  startDate?: string | null

  @Property({ name: 'end_date', type: 'date', nullable: true })
  endDate?: string | null

  /**
   * Entered by hand, not derived from sub-tasks. A person saying "this is 80%
   * done" and a computer counting checkboxes are different claims, and the
   * first is the one worth recording.
   */
  @Property({ name: 'percent_done', type: 'smallint' })
  percentDone: number = 0

  /**
   * Per-project counter behind the human reference (`เว็บ CC Tech-12`), so a
   * task can be named in a phone call without reading out a uuid.
   */
  @Property({ name: 'identifier_index', type: 'int' })
  identifierIndex: number = 0

  /**
   * Which column of the board it sits in. Null until the project has a board,
   * which is why the board reads "unplaced" cards into its first column rather
   * than hiding work that predates it.
   */
  @Property({ name: 'bucket_id', type: 'uuid', nullable: true })
  @Index()
  bucketId?: string | null

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
 * A label, shared across the organization's projects. Kept flat: a tag tree is
 * a filing system, and this team files by project already.
 */
@Entity({ tableName: 'orva_tasking_labels' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class TaskLabel {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  title!: string

  /** `#rrggbb`. Validated on the way in so the UI never has to guess. */
  @Property({ name: 'hex_color', type: 'text' })
  hexColor: string = '#64748b'

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
 * Which labels are on which task. A junction row carries no history worth
 * keeping, so removing a label deletes the row outright rather than leaving a
 * soft-deleted one the unique index would then collide with.
 */
@Entity({ tableName: 'orva_tasking_task_labels' })
@Index({ properties: ['tenantId', 'taskId'] })
export class TaskLabelLink {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'task_id', type: 'uuid' })
  taskId!: string

  @Property({ name: 'label_id', type: 'uuid' })
  @Index()
  labelId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

/**
 * How two tasks relate. Both directions are stored, so reading one task's
 * relations never needs a union: adding `subtask` also writes `parent` back.
 *
 * Five stored kinds for three user-facing ones — `related` is its own inverse.
 */
@Entity({ tableName: 'orva_tasking_task_relations' })
@Index({ properties: ['tenantId', 'taskId'] })
export class TaskRelation {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'task_id', type: 'uuid' })
  taskId!: string

  @Property({ name: 'other_task_id', type: 'uuid' })
  @Index()
  otherTaskId!: string

  /** `subtask` · `parent` · `blocks` · `blocked_by` · `related` */
  @Property({ type: 'text' })
  kind!: string

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

/**
 * A comment on a task, from a staff member or — later, once the portal ships —
 * from a customer.
 *
 * `isCustomerVisible` defaults to **false**: the team has to be able to write
 * an internal note in the same place the work happens. The work itself is the
 * opposite — a task inside a published project is visible unless hidden — and
 * that asymmetry is the point.
 *
 * The body is stored unencrypted, deliberately. It has to be searchable and
 * sortable, and this repository has twice shipped bugs from reading encrypted
 * columns in raw SQL. It is protected by RLS, the feature gate, and the
 * visibility default instead.
 */
@Entity({ tableName: 'orva_tasking_task_comments' })
@Index({ properties: ['tenantId', 'taskId'] })
export class TaskComment {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'task_id', type: 'uuid' })
  taskId!: string

  @Property({ type: 'text' })
  body!: string

  /** An Orva user. Exactly one author column is set. */
  @Property({ name: 'author_user_id', type: 'uuid', nullable: true })
  authorUserId?: string | null

  /** A portal customer user — unused until the portal ships. */
  @Property({ name: 'author_customer_user_id', type: 'uuid', nullable: true })
  authorCustomerUserId?: string | null

  @Property({ name: 'is_customer_visible', type: 'boolean' })
  isCustomerVisible: boolean = false

  /** Set on an edit, so a changed comment cannot pass as the original. */
  @Property({ name: 'edited_at', type: Date, nullable: true })
  editedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * Whether a file attached to a task may be shown to a customer.
 *
 * A separate row rather than a column because the file itself belongs to the
 * installed `attachments` module, which this module must not modify. Absence
 * of a row means not visible.
 */
@Entity({ tableName: 'orva_tasking_task_attachment_flags' })
@Index({ properties: ['tenantId', 'taskId'] })
export class TaskAttachmentFlag {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'task_id', type: 'uuid' })
  taskId!: string

  @Property({ name: 'attachment_id', type: 'uuid' })
  @Index()
  attachmentId!: string

  @Property({ name: 'is_customer_visible', type: 'boolean' })
  isCustomerVisible: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

/**
 * A column on a project's board.
 *
 * Buckets hang off the project, not off a saved view. Vikunja attaches them to
 * a view because it lets a user define many views per project; this module has
 * four fixed views instead, so a second level of indirection would buy nothing
 * and cost every read a join.
 */
@Entity({ tableName: 'orva_tasking_buckets' })
@Index({ properties: ['tenantId', 'projectId'] })
export class TaskBucket {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'project_id', type: 'uuid' })
  projectId!: string

  @Property({ type: 'text' })
  title!: string

  @Property({ type: 'int' })
  position: number = 0

  /**
   * How many unfinished cards this column should hold. 0 means no limit.
   *
   * Exceeding it warns and still allows the drop. A hard block teaches people
   * to keep their real work list somewhere the tool cannot see it.
   */
  @Property({ name: 'wip_limit', type: 'int' })
  wipLimit: number = 0

  /**
   * At most one per project. Dropping a card here ticks it done, and taking it
   * out reopens it, so the board and the checkbox can never disagree.
   */
  @Property({ name: 'is_done_bucket', type: 'boolean' })
  isDoneBucket: boolean = false

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
