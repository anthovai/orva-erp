import { Migration } from '@mikro-orm/migrations'

/**
 * One tasking project ↔ one staff timesheet project.
 *
 * Additive: no upstream table is touched. `staff_time_projects` is written
 * through its own API, never by reaching into its table, so this migration
 * owns exactly one table and can be dropped again without leaving anything
 * behind but rows nobody reads.
 */
export class Migration20260907210000_time_project_links extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table "orva_time_project_links" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "tasking_project_id" uuid not null,
      "time_project_id" uuid not null,
      "code" text not null,
      "synced_name" text not null,
      "synced_status" text not null default 'active',
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_time_project_links_pkey" primary key ("id"),
      constraint "orva_time_project_links_status_check" check ("synced_status" in ('active','on_hold','completed'))
    );`)
    this.addSql('create index "orva_time_project_links_tenant_org_idx" on "orva_time_project_links" ("tenant_id", "organization_id");')

    // Neither end may be linked twice. These are what make the reconcile
    // command safe to run repeatedly: a second run cannot double a pair.
    this.addSql(`create unique index "orva_time_project_links_tasking_unique"
      on "orva_time_project_links" ("tenant_id", "tasking_project_id")
      where "deleted_at" is null;`)
    this.addSql(`create unique index "orva_time_project_links_time_unique"
      on "orva_time_project_links" ("tenant_id", "time_project_id")
      where "deleted_at" is null;`)

    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "orva_time_project_links";')
  }
}
