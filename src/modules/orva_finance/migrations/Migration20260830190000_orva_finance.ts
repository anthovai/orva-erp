import { Migration } from '@mikro-orm/migrations';

export class Migration20260830190000_orva_finance extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "orva_gl_journals" add column "journal_kind" text not null default 'standard';`);
    this.addSql(`alter table "orva_gl_journals" add constraint "orva_gl_journals_kind_check" check ("journal_kind" in ('standard','closing'));`);
    // At most one closing journal per period, forever, at the database.
    this.addSql(`create unique index "orva_gl_journals_closing_per_period_unique" on "orva_gl_journals" ("tenant_id", "period_id") where "journal_kind" = 'closing' and "deleted_at" is null;`);

    this.addSql(`create table "orva_gl_settings" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "retained_earnings_account_id" uuid not null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      constraint "orva_gl_settings_pkey" primary key ("id"),
      constraint "orva_gl_settings_re_account_fk" foreign key ("retained_earnings_account_id") references "orva_gl_accounts" ("id")
    );`);
    this.addSql(`create unique index "orva_gl_settings_scope_unique" on "orva_gl_settings" ("tenant_id", "organization_id");`);

    // Orva rule: every new tenant-scoped table gets RLS (see CLAUDE.md).
    this.addSql(`select orva_apply_rls();`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "orva_gl_settings" cascade;`);
    this.addSql(`drop index if exists "orva_gl_journals_closing_per_period_unique";`);
    this.addSql(`alter table "orva_gl_journals" drop constraint if exists "orva_gl_journals_kind_check";`);
    this.addSql(`alter table "orva_gl_journals" drop column if exists "journal_kind";`);
  }

}
