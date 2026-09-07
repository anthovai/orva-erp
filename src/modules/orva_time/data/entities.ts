import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

/**
 * One tasking project ↔ one staff timesheet project.
 *
 * Both ids are bare uuids into other modules' tables — cross-module ORM
 * relations are forbidden by `AGENTS.md`, and this row is the whole reason the
 * link is not inferred from a name or a code. Upstream's `code` is unique per
 * organization and editable by whoever opens the โครงการ screen; a link that
 * lived in that column would break the first time somebody tidied it up.
 *
 * `syncedName` and `syncedStatus` are the last values the sync itself wrote.
 * They do two jobs:
 *
 *  - they break the propagation loop. A → B → A stops on value equality
 *    alone, with no origin flag to lose and no suppression window to expire.
 *  - they are the drift oracle. When neither side matches them, both sides
 *    were edited independently, and `mercato orva_time sync` says so rather
 *    than silently choosing a winner.
 */
@Entity({ tableName: 'orva_time_project_links' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class TimeProjectLink {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** `orva_tasking_projects.id`. One link per project (unique, live rows). */
  @Property({ name: 'tasking_project_id', type: 'uuid' })
  taskingProjectId!: string

  /** `staff_time_projects.id`. One link per time project (unique, live rows). */
  @Property({ name: 'time_project_id', type: 'uuid' })
  timeProjectId!: string

  /** The code orva_time generated and now owns; read-only on the โครงการ screen. */
  @Property({ type: 'text' })
  code!: string

  @Property({ name: 'synced_name', type: 'text' })
  syncedName!: string

  @Property({ name: 'synced_status', type: 'text' })
  syncedStatus!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
