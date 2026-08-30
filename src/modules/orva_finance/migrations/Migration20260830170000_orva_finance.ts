import { Migration } from '@mikro-orm/migrations';

export class Migration20260830170000_orva_finance extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "orva_ar_settings" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "ar_account_id" uuid not null,
      "revenue_account_id" uuid not null,
      "tax_account_id" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      constraint "orva_ar_settings_pkey" primary key ("id"),
      constraint "orva_ar_settings_ar_account_fk" foreign key ("ar_account_id") references "orva_gl_accounts" ("id"),
      constraint "orva_ar_settings_revenue_account_fk" foreign key ("revenue_account_id") references "orva_gl_accounts" ("id"),
      constraint "orva_ar_settings_tax_account_fk" foreign key ("tax_account_id") references "orva_gl_accounts" ("id")
    );`);
    this.addSql(`create unique index "orva_ar_settings_scope_unique" on "orva_ar_settings" ("tenant_id", "organization_id");`);

    this.addSql(`create table "orva_ar_invoice_postings" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "invoice_id" uuid not null,
      "invoice_number" text not null,
      "journal_id" uuid not null,
      "amount" numeric(18,4) not null default 0,
      "posted_by" uuid null,
      "created_at" timestamptz not null,
      constraint "orva_ar_invoice_postings_pkey" primary key ("id"),
      constraint "orva_ar_invoice_postings_journal_fk" foreign key ("journal_id") references "orva_gl_journals" ("id"),
      constraint "orva_ar_invoice_postings_amount_check" check ("amount" > 0)
    );`);
    this.addSql(`create index "orva_ar_invoice_postings_tenant_org_idx" on "orva_ar_invoice_postings" ("tenant_id", "organization_id");`);
    this.addSql(`create index "orva_ar_invoice_postings_invoice_idx" on "orva_ar_invoice_postings" ("invoice_id");`);
    this.addSql(`create unique index "orva_ar_invoice_postings_invoice_unique" on "orva_ar_invoice_postings" ("tenant_id", "invoice_id");`);

    // A posting record is an accounting fact: never updated, never deleted.
    this.addSql(`
create or replace function orva_ar_posting_guard() returns trigger language plpgsql as $orva$
begin
  raise exception 'orva_ar: invoice posting records are immutable';
end
$orva$;`);
    this.addSql(`create trigger orva_ar_posting_guard_trg before update or delete on "orva_ar_invoice_postings" for each row execute function orva_ar_posting_guard();`);

    // Orva rule: every new tenant-scoped table gets RLS (see CLAUDE.md).
    this.addSql(`select orva_apply_rls();`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop trigger if exists orva_ar_posting_guard_trg on "orva_ar_invoice_postings";`);
    this.addSql(`drop function if exists orva_ar_posting_guard();`);
    this.addSql(`drop table if exists "orva_ar_invoice_postings" cascade;`);
    this.addSql(`drop table if exists "orva_ar_settings" cascade;`);
  }

}
