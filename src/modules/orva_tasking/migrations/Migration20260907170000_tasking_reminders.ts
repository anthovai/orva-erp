import { Migration } from '@mikro-orm/migrations'

/**
 * Phase 4 of the tasking parity spec: work that reminds people.
 *
 * A reminder is either an absolute moment or an offset from one of the task's
 * own dates. Both in one table with a check constraint, rather than two
 * tables, because the reader wants them merged and sorted anyway.
 */
export class Migration20260907170000_tasking_reminders extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table "orva_tasking_task_reminders" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "task_id" uuid not null references "orva_tasking_tasks" ("id") on delete cascade,
      "remind_at" timestamptz null,
      "relative_to" text null,
      "relative_minutes" int null,
      "last_fired_at" timestamptz null,
      "created_by" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      constraint "orva_tasking_task_reminders_pkey" primary key ("id"),
      constraint "orva_tasking_task_reminders_anchor_check" check ("relative_to" is null or "relative_to" in ('due', 'start', 'end')),
      -- Exactly one kind: an absolute moment, or an offset from a date the
      -- task carries. A row that is both would fire twice; neither, never.
      constraint "orva_tasking_task_reminders_kind_check" check (
        ("remind_at" is not null and "relative_to" is null and "relative_minutes" is null)
        or ("remind_at" is null and "relative_to" is not null and "relative_minutes" is not null)
      )
    );`)
    this.addSql('create index "orva_tasking_task_reminders_tenant_task_idx" on "orva_tasking_task_reminders" ("tenant_id", "task_id");')

    // ---- repeating tasks -----------------------------------------------------
    this.addSql('alter table "orva_tasking_tasks" add column "repeat_every_days" int null;')
    this.addSql('alter table "orva_tasking_tasks" add column "repeat_mode" text null;')
    /**
     * Both halves of the repeat, or neither.
     *
     * Every branch tests for null explicitly. A CHECK constraint only rejects
     * a row when it evaluates to FALSE — an expression that comes out NULL is
     * accepted. `"repeat_mode" in (...)` against a null mode is NULL, not
     * false, so the obvious spelling of this constraint let a task through
     * with an interval and no mode. Caught by replaying the migration over
     * real rows before applying it.
     */
    this.addSql(`alter table "orva_tasking_tasks"
      add constraint "orva_tasking_tasks_repeat_check" check (
        ("repeat_every_days" is null and "repeat_mode" is null)
        or (
          "repeat_every_days" is not null and "repeat_every_days" > 0
          and "repeat_mode" is not null
          and "repeat_mode" in ('from_due', 'from_completion')
        )
      );`)
    // A repeat needs a date to move forward from. Without one there is nothing
    // to shift, and the worker would create identical copies for ever.
    this.addSql(`alter table "orva_tasking_tasks"
      add constraint "orva_tasking_tasks_repeat_anchor_check" check (
        "repeat_every_days" is null
        or "due_on" is not null or "start_date" is not null or "end_date" is not null
      );`)

    /**
     * Which completed task each successor came from, and for which occurrence.
     *
     * This pair is what makes the roll worker idempotent: a second run finds
     * the row already there and creates nothing. Without it, every re-run,
     * retry or double tick would add another copy.
     */
    this.addSql('alter table "orva_tasking_tasks" add column "repeat_source_id" uuid null references "orva_tasking_tasks" ("id") on delete set null;')
    this.addSql('alter table "orva_tasking_tasks" add column "repeat_occurrence" date null;')
    this.addSql(`create unique index "orva_tasking_tasks_repeat_occurrence_unique"
      on "orva_tasking_tasks" ("repeat_source_id", "repeat_occurrence")
      where "repeat_source_id" is not null;`)

    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('drop index if exists "orva_tasking_tasks_repeat_occurrence_unique";')
    this.addSql('alter table "orva_tasking_tasks" drop column if exists "repeat_occurrence";')
    this.addSql('alter table "orva_tasking_tasks" drop column if exists "repeat_source_id";')
    this.addSql('alter table "orva_tasking_tasks" drop constraint if exists "orva_tasking_tasks_repeat_anchor_check";')
    this.addSql('alter table "orva_tasking_tasks" drop constraint if exists "orva_tasking_tasks_repeat_check";')
    this.addSql('alter table "orva_tasking_tasks" drop column if exists "repeat_mode";')
    this.addSql('alter table "orva_tasking_tasks" drop column if exists "repeat_every_days";')
    this.addSql('drop table if exists "orva_tasking_task_reminders";')
  }
}
