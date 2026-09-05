import { Migration } from '@mikro-orm/migrations'

/**
 * Phase 1 of the tasking parity spec: enough detail on a task to plan with.
 *
 * Dates, a hand-entered percentage and a human-readable number on the task
 * itself; labels, relations, comments and per-file customer visibility beside
 * it. Every added column is nullable or defaulted so this applies to a
 * populated table without rewriting it.
 */
export class Migration20260906140000_tasking_detail extends Migration {
  async up(): Promise<void> {
    // ---- task detail columns -------------------------------------------------
    this.addSql('alter table "orva_tasking_tasks" add column "start_date" date null;')
    this.addSql('alter table "orva_tasking_tasks" add column "end_date" date null;')
    this.addSql('alter table "orva_tasking_tasks" add column "percent_done" smallint not null default 0;')
    this.addSql('alter table "orva_tasking_tasks" add column "identifier_index" int null;')

    this.addSql('create index "orva_tasking_tasks_start_idx" on "orva_tasking_tasks" ("tenant_id", "organization_id", "start_date");')
    // A duration runs forwards. Enforced in the database because a timeline that
    // renders a negative bar is a rendering bug chasing a data bug.
    this.addSql('alter table "orva_tasking_tasks" add constraint "orva_tasking_tasks_dates_check" check ("start_date" is null or "end_date" is null or "start_date" <= "end_date");')
    this.addSql('alter table "orva_tasking_tasks" add constraint "orva_tasking_tasks_percent_check" check ("percent_done" between 0 and 100);')

    // Number the tasks that already exist, oldest first within each project, so
    // the counter reads like the order the work was written down.
    this.addSql(`update "orva_tasking_tasks" t
      set "identifier_index" = n."rn"
      from (
        select "id", row_number() over (partition by "project_id" order by "created_at", "id") as "rn"
        from "orva_tasking_tasks"
      ) n
      where n."id" = t."id";`)
    this.addSql('alter table "orva_tasking_tasks" alter column "identifier_index" set not null;')
    this.addSql('alter table "orva_tasking_tasks" alter column "identifier_index" set default 0;')
    // Numbers are never reused, so soft-deleted rows keep theirs and stay in the
    // index — otherwise a deleted "CC Tech-7" could be reissued to new work.
    this.addSql('create unique index "orva_tasking_tasks_identifier_unique" on "orva_tasking_tasks" ("project_id", "identifier_index");')

    // ---- labels --------------------------------------------------------------
    this.addSql(`create table "orva_tasking_labels" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "title" text not null,
      "hex_color" text not null default '#64748b',
      "created_by" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_tasking_labels_pkey" primary key ("id"),
      constraint "orva_tasking_labels_color_check" check ("hex_color" ~ '^#[0-9a-fA-F]{6}$')
    );`)
    this.addSql('create index "orva_tasking_labels_tenant_org_idx" on "orva_tasking_labels" ("tenant_id", "organization_id");')
    // Case-insensitive: "ด่วน" and "ด่วน " are the same label to a person, and two
    // labels that look identical are worse than none.
    this.addSql('create unique index "orva_tasking_labels_title_unique" on "orva_tasking_labels" ("tenant_id", "organization_id", lower("title")) where "deleted_at" is null;')

    this.addSql(`create table "orva_tasking_task_labels" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "task_id" uuid not null references "orva_tasking_tasks" ("id") on delete cascade,
      "label_id" uuid not null references "orva_tasking_labels" ("id") on delete cascade,
      "created_at" timestamptz not null,
      constraint "orva_tasking_task_labels_pkey" primary key ("id")
    );`)
    this.addSql('create index "orva_tasking_task_labels_tenant_task_idx" on "orva_tasking_task_labels" ("tenant_id", "task_id");')
    this.addSql('create index "orva_tasking_task_labels_label_idx" on "orva_tasking_task_labels" ("label_id");')
    this.addSql('create unique index "orva_tasking_task_labels_unique" on "orva_tasking_task_labels" ("task_id", "label_id");')

    // ---- relations -----------------------------------------------------------
    this.addSql(`create table "orva_tasking_task_relations" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "task_id" uuid not null references "orva_tasking_tasks" ("id") on delete cascade,
      "other_task_id" uuid not null references "orva_tasking_tasks" ("id") on delete cascade,
      "kind" text not null,
      "created_by" uuid null,
      "created_at" timestamptz not null,
      constraint "orva_tasking_task_relations_pkey" primary key ("id"),
      constraint "orva_tasking_task_relations_kind_check" check ("kind" in ('subtask', 'parent', 'blocks', 'blocked_by', 'related')),
      -- A task cannot be its own subtask, blocker or sibling.
      constraint "orva_tasking_task_relations_self_check" check ("task_id" <> "other_task_id")
    );`)
    this.addSql('create index "orva_tasking_task_relations_tenant_task_idx" on "orva_tasking_task_relations" ("tenant_id", "task_id");')
    this.addSql('create index "orva_tasking_task_relations_other_idx" on "orva_tasking_task_relations" ("other_task_id");')
    this.addSql('create unique index "orva_tasking_task_relations_unique" on "orva_tasking_task_relations" ("task_id", "other_task_id", "kind");')

    // ---- comments ------------------------------------------------------------
    this.addSql(`create table "orva_tasking_task_comments" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "task_id" uuid not null references "orva_tasking_tasks" ("id") on delete cascade,
      "body" text not null,
      "author_user_id" uuid null,
      "author_customer_user_id" uuid null,
      "is_customer_visible" boolean not null default false,
      "edited_at" timestamptz null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_tasking_task_comments_pkey" primary key ("id"),
      -- Exactly one author. A comment with neither cannot be attributed; a
      -- comment with both would let a staff note be shown as a customer's words.
      constraint "orva_tasking_task_comments_author_check" check (
        ("author_user_id" is not null and "author_customer_user_id" is null)
        or ("author_user_id" is null and "author_customer_user_id" is not null)
      )
    );`)
    this.addSql('create index "orva_tasking_task_comments_tenant_task_idx" on "orva_tasking_task_comments" ("tenant_id", "task_id", "created_at");')

    // ---- per-file customer visibility ---------------------------------------
    this.addSql(`create table "orva_tasking_task_attachment_flags" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "task_id" uuid not null references "orva_tasking_tasks" ("id") on delete cascade,
      "attachment_id" uuid not null,
      "is_customer_visible" boolean not null default false,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      constraint "orva_tasking_task_attachment_flags_pkey" primary key ("id")
    );`)
    this.addSql('create index "orva_tasking_task_attachment_flags_tenant_task_idx" on "orva_tasking_task_attachment_flags" ("tenant_id", "task_id");')
    this.addSql('create unique index "orva_tasking_task_attachment_flags_unique" on "orva_tasking_task_attachment_flags" ("attachment_id");')

    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "orva_tasking_task_attachment_flags";')
    this.addSql('drop table if exists "orva_tasking_task_comments";')
    this.addSql('drop table if exists "orva_tasking_task_relations";')
    this.addSql('drop table if exists "orva_tasking_task_labels";')
    this.addSql('drop table if exists "orva_tasking_labels";')
    this.addSql('drop index if exists "orva_tasking_tasks_identifier_unique";')
    this.addSql('drop index if exists "orva_tasking_tasks_start_idx";')
    this.addSql('alter table "orva_tasking_tasks" drop constraint if exists "orva_tasking_tasks_dates_check";')
    this.addSql('alter table "orva_tasking_tasks" drop constraint if exists "orva_tasking_tasks_percent_check";')
    this.addSql('alter table "orva_tasking_tasks" drop column if exists "identifier_index";')
    this.addSql('alter table "orva_tasking_tasks" drop column if exists "percent_done";')
    this.addSql('alter table "orva_tasking_tasks" drop column if exists "end_date";')
    this.addSql('alter table "orva_tasking_tasks" drop column if exists "start_date";')
  }
}
