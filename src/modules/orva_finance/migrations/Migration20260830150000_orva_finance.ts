import { Migration } from '@mikro-orm/migrations';

export class Migration20260830150000_orva_finance extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "orva_ap_settings" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "ap_account_id" uuid not null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      constraint "orva_ap_settings_pkey" primary key ("id"),
      constraint "orva_ap_settings_account_fk" foreign key ("ap_account_id") references "orva_gl_accounts" ("id")
    );`);
    this.addSql(`create unique index "orva_ap_settings_scope_unique" on "orva_ap_settings" ("tenant_id", "organization_id");`);

    this.addSql(`create table "orva_ap_bills" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "bill_no" text null,
      "status" text not null default 'draft',
      "vendor_party_id" uuid not null,
      "vendor_bill_ref" text null,
      "period_id" uuid not null,
      "bill_date" date not null,
      "due_date" date null,
      "currency_code" text not null default 'THB',
      "memo" text null,
      "total_amount" numeric(18,4) not null default 0,
      "journal_id" uuid null,
      "posted_at" timestamptz null,
      "posted_by" uuid null,
      "created_by" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_ap_bills_pkey" primary key ("id"),
      constraint "orva_ap_bills_status_check" check ("status" in ('draft','posted')),
      constraint "orva_ap_bills_period_fk" foreign key ("period_id") references "orva_fiscal_periods" ("id"),
      constraint "orva_ap_bills_journal_fk" foreign key ("journal_id") references "orva_gl_journals" ("id")
    );`);
    this.addSql(`create index "orva_ap_bills_tenant_org_idx" on "orva_ap_bills" ("tenant_id", "organization_id");`);
    this.addSql(`create index "orva_ap_bills_vendor_idx" on "orva_ap_bills" ("vendor_party_id");`);
    this.addSql(`create unique index "orva_ap_bills_active_no_unique" on "orva_ap_bills" ("tenant_id", "bill_no") where "deleted_at" is null and "bill_no" is not null;`);

    this.addSql(`create table "orva_ap_bill_lines" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "bill_id" uuid not null,
      "line_no" int not null,
      "expense_account_id" uuid not null,
      "amount" numeric(18,4) not null default 0,
      "description" text null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_ap_bill_lines_pkey" primary key ("id"),
      constraint "orva_ap_bill_lines_bill_fk" foreign key ("bill_id") references "orva_ap_bills" ("id"),
      constraint "orva_ap_bill_lines_account_fk" foreign key ("expense_account_id") references "orva_gl_accounts" ("id"),
      constraint "orva_ap_bill_lines_amount_check" check ("amount" > 0)
    );`);
    this.addSql(`create index "orva_ap_bill_lines_tenant_org_idx" on "orva_ap_bill_lines" ("tenant_id", "organization_id");`);
    this.addSql(`create index "orva_ap_bill_lines_bill_idx" on "orva_ap_bill_lines" ("bill_id");`);

    // Posted bills are immutable and undeletable, mirroring the GL journal
    // guard. When a payments phase lands, the guard will be relaxed to allow
    // the specific paid-amount transition — never general edits.
    this.addSql(`
create or replace function orva_ap_bill_guard() returns trigger language plpgsql as $orva$
begin
  if tg_op = 'DELETE' then
    if old.status = 'posted' then
      raise exception 'orva_ap: posted bill % cannot be deleted', old.bill_no;
    end if;
    return old;
  end if;
  if old.status = 'posted' then
    raise exception 'orva_ap: posted bill % is immutable', old.bill_no;
  end if;
  return new;
end
$orva$;`);
    this.addSql(`create trigger orva_ap_bill_guard_trg before update or delete on "orva_ap_bills" for each row execute function orva_ap_bill_guard();`);

    this.addSql(`
create or replace function orva_ap_bill_line_guard() returns trigger language plpgsql as $orva$
declare
  b_status text;
begin
  select status into b_status from orva_ap_bills where id = coalesce(new.bill_id, old.bill_id);
  if b_status = 'posted' then
    raise exception 'orva_ap: lines of a posted bill are immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$orva$;`);
    this.addSql(`create trigger orva_ap_bill_line_guard_trg before insert or update or delete on "orva_ap_bill_lines" for each row execute function orva_ap_bill_line_guard();`);

    // Orva rule: every new tenant-scoped table gets RLS (see CLAUDE.md).
    this.addSql(`select orva_apply_rls();`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "orva_ap_bill_lines" cascade;`);
    this.addSql(`drop table if exists "orva_ap_bills" cascade;`);
    this.addSql(`drop table if exists "orva_ap_settings" cascade;`);
    this.addSql(`drop function if exists orva_ap_bill_guard();`);
    this.addSql(`drop function if exists orva_ap_bill_line_guard();`);
  }

}
