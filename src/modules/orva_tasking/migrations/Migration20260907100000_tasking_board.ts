import { Migration } from '@mikro-orm/migrations'

/**
 * Phase 2 of the tasking parity spec: the board's columns.
 *
 * No default buckets are seeded here. A board is created from the screen, in
 * the language the user is reading, and the same call places the project's
 * existing tasks — seeding titles from a migration would hard-code Thai into
 * every future tenant's database.
 */
export class Migration20260907100000_tasking_board extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table "orva_tasking_buckets" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "project_id" uuid not null references "orva_tasking_projects" ("id") on delete cascade,
      "title" text not null,
      "position" int not null default 0,
      "wip_limit" int not null default 0,
      "is_done_bucket" boolean not null default false,
      "created_by" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_tasking_buckets_pkey" primary key ("id"),
      constraint "orva_tasking_buckets_wip_check" check ("wip_limit" >= 0)
    );`)
    this.addSql('create index "orva_tasking_buckets_tenant_project_idx" on "orva_tasking_buckets" ("tenant_id", "project_id", "position");')
    // At most one done column per project: two would make "dropped it in Done"
    // an ambiguous instruction, and the checkbox could no longer agree with the
    // board.
    this.addSql('create unique index "orva_tasking_buckets_done_unique" on "orva_tasking_buckets" ("project_id") where "is_done_bucket" and "deleted_at" is null;')

    this.addSql('alter table "orva_tasking_tasks" add column "bucket_id" uuid null references "orva_tasking_buckets" ("id") on delete set null;')
    // The board reads a column in one indexed pass, unfinished cards first.
    this.addSql('create index "orva_tasking_tasks_bucket_idx" on "orva_tasking_tasks" ("bucket_id", "position");')

    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('drop index if exists "orva_tasking_tasks_bucket_idx";')
    this.addSql('alter table "orva_tasking_tasks" drop column if exists "bucket_id";')
    this.addSql('drop table if exists "orva_tasking_buckets";')
  }
}
