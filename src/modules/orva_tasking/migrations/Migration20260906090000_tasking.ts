import { Migration } from '@mikro-orm/migrations'

/** Projects and tasks, in the same database as the money they belong to. */
export class Migration20260906090000_tasking extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table "orva_tasking_projects" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "name" text not null,
      "description" text null,
      "quote_id" uuid null,
      "is_archived" boolean not null default false,
      "position" int not null default 0,
      "created_by" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_tasking_projects_pkey" primary key ("id")
    );`)
    this.addSql('create index "orva_tasking_projects_tenant_org_idx" on "orva_tasking_projects" ("tenant_id", "organization_id");')
    this.addSql('create index "orva_tasking_projects_quote_idx" on "orva_tasking_projects" ("quote_id");')
    // One project per quotation: the Projects screen shows a single work
    // percentage beside the billing percentage, which two projects would make
    // ambiguous.
    this.addSql('create unique index "orva_tasking_projects_quote_unique" on "orva_tasking_projects" ("tenant_id", "quote_id") where "quote_id" is not null and "deleted_at" is null;')

    this.addSql(`create table "orva_tasking_tasks" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "project_id" uuid not null references "orva_tasking_projects" ("id"),
      "title" text not null,
      "description" text null,
      "done" boolean not null default false,
      "done_at" timestamptz null,
      "due_on" date null,
      "priority" int not null default 0,
      "position" int not null default 0,
      "assignee_user_id" uuid null,
      "created_by" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_tasking_tasks_pkey" primary key ("id"),
      constraint "orva_tasking_tasks_priority_check" check ("priority" between 0 and 4),
      -- done and done_at must agree: a finished task always carries when, and
      -- an unfinished one never does, so "finished last week" stays answerable.
      constraint "orva_tasking_tasks_done_at_check" check (("done" and "done_at" is not null) or (not "done" and "done_at" is null))
    );`)
    this.addSql('create index "orva_tasking_tasks_tenant_org_idx" on "orva_tasking_tasks" ("tenant_id", "organization_id");')
    this.addSql('create index "orva_tasking_tasks_project_idx" on "orva_tasking_tasks" ("project_id");')
    this.addSql('create index "orva_tasking_tasks_due_idx" on "orva_tasking_tasks" ("due_on");')

    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "orva_tasking_tasks";')
    this.addSql('drop table if exists "orva_tasking_projects";')
  }
}
