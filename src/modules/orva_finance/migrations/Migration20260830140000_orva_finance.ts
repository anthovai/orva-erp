import { Migration } from '@mikro-orm/migrations';

export class Migration20260830140000_orva_finance extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "orva_gl_accounts" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "code" text not null,
      "name" text not null,
      "account_type" text not null,
      "parent_id" uuid null,
      "is_active" boolean not null default true,
      "created_by" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_gl_accounts_pkey" primary key ("id"),
      constraint "orva_gl_accounts_type_check" check ("account_type" in ('asset','liability','equity','income','expense')),
      constraint "orva_gl_accounts_parent_fk" foreign key ("parent_id") references "orva_gl_accounts" ("id")
    );`);
    this.addSql(`create index "orva_gl_accounts_tenant_org_idx" on "orva_gl_accounts" ("tenant_id", "organization_id");`);
    this.addSql(`create unique index "orva_gl_accounts_active_code_unique" on "orva_gl_accounts" ("tenant_id", "code") where "deleted_at" is null;`);

    this.addSql(`create table "orva_fiscal_periods" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "code" text not null,
      "starts_on" date not null,
      "ends_on" date not null,
      "status" text not null default 'open',
      "created_by" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_fiscal_periods_pkey" primary key ("id"),
      constraint "orva_fiscal_periods_status_check" check ("status" in ('open','closed')),
      constraint "orva_fiscal_periods_range_check" check ("starts_on" <= "ends_on")
    );`);
    this.addSql(`create index "orva_fiscal_periods_tenant_org_idx" on "orva_fiscal_periods" ("tenant_id", "organization_id");`);
    this.addSql(`create unique index "orva_fiscal_periods_active_code_unique" on "orva_fiscal_periods" ("tenant_id", "code") where "deleted_at" is null;`);

    this.addSql(`create table "orva_gl_journals" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "journal_no" text null,
      "status" text not null default 'draft',
      "period_id" uuid not null,
      "journal_date" date not null,
      "currency_code" text not null default 'THB',
      "memo" text null,
      "total_debit" numeric(18,4) not null default 0,
      "total_credit" numeric(18,4) not null default 0,
      "posted_at" timestamptz null,
      "posted_by" uuid null,
      "created_by" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_gl_journals_pkey" primary key ("id"),
      constraint "orva_gl_journals_status_check" check ("status" in ('draft','posted')),
      constraint "orva_gl_journals_period_fk" foreign key ("period_id") references "orva_fiscal_periods" ("id")
    );`);
    this.addSql(`create index "orva_gl_journals_tenant_org_idx" on "orva_gl_journals" ("tenant_id", "organization_id");`);
    this.addSql(`create index "orva_gl_journals_period_idx" on "orva_gl_journals" ("period_id");`);
    this.addSql(`create unique index "orva_gl_journals_active_no_unique" on "orva_gl_journals" ("tenant_id", "journal_no") where "deleted_at" is null and "journal_no" is not null;`);

    this.addSql(`create table "orva_gl_journal_lines" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "journal_id" uuid not null,
      "line_no" int not null,
      "account_id" uuid not null,
      "party_id" uuid null,
      "debit" numeric(18,4) not null default 0,
      "credit" numeric(18,4) not null default 0,
      "description" text null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_gl_journal_lines_pkey" primary key ("id"),
      constraint "orva_gl_journal_lines_journal_fk" foreign key ("journal_id") references "orva_gl_journals" ("id"),
      constraint "orva_gl_journal_lines_account_fk" foreign key ("account_id") references "orva_gl_accounts" ("id"),
      constraint "orva_gl_journal_lines_amounts_check" check ("debit" >= 0 and "credit" >= 0 and not ("debit" > 0 and "credit" > 0))
    );`);
    this.addSql(`create index "orva_gl_journal_lines_tenant_org_idx" on "orva_gl_journal_lines" ("tenant_id", "organization_id");`);
    this.addSql(`create index "orva_gl_journal_lines_journal_idx" on "orva_gl_journal_lines" ("journal_id");`);
    this.addSql(`create index "orva_gl_journal_lines_account_idx" on "orva_gl_journal_lines" ("account_id");`);

    this.addSql(`create table "orva_gl_sequences" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "kind" text not null,
      "next_value" bigint not null,
      constraint "orva_gl_sequences_pkey" primary key ("id")
    );`);
    this.addSql(`create unique index "orva_gl_sequences_scope_unique" on "orva_gl_sequences" ("tenant_id", "organization_id", "kind");`);

    // ---- Accounting invariants enforced below the application layer ----

    // A posted journal is immutable and undeletable. The only legal UPDATE of a
    // posted row is none at all; the draft->posted transition happens while the
    // OLD row is still 'draft'. Posting also requires: balanced totals, at
    // least one line pair, and an OPEN period whose range contains journal_date.
    this.addSql(`
create or replace function orva_gl_journal_guard() returns trigger language plpgsql as $orva$
declare
  p record;
begin
  if tg_op = 'DELETE' then
    if old.status = 'posted' then
      raise exception 'orva_gl: posted journal % cannot be deleted', old.journal_no;
    end if;
    return old;
  end if;
  if old.status = 'posted' then
    raise exception 'orva_gl: posted journal % is immutable', old.journal_no;
  end if;
  if new.status = 'posted' and old.status = 'draft' then
    if new.total_debit <> new.total_credit or new.total_debit <= 0 then
      raise exception 'orva_gl: journal % is not balanced (debit %, credit %)', new.journal_no, new.total_debit, new.total_credit;
    end if;
    select * into p from orva_fiscal_periods where id = new.period_id and deleted_at is null;
    if p is null then
      raise exception 'orva_gl: journal % references a missing period', new.journal_no;
    end if;
    if p.status <> 'open' then
      raise exception 'orva_gl: period % is closed', p.code;
    end if;
    if new.journal_date < p.starts_on or new.journal_date > p.ends_on then
      raise exception 'orva_gl: journal date % outside period %', new.journal_date, p.code;
    end if;
  end if;
  return new;
end
$orva$;`);
    this.addSql(`create trigger orva_gl_journal_guard_trg before update or delete on "orva_gl_journals" for each row execute function orva_gl_journal_guard();`);

    // Lines of a posted journal are frozen too (soft delete is an UPDATE, so
    // this also blocks soft-deleting posted lines).
    this.addSql(`
create or replace function orva_gl_journal_line_guard() returns trigger language plpgsql as $orva$
declare
  j_status text;
begin
  select status into j_status from orva_gl_journals where id = coalesce(new.journal_id, old.journal_id);
  if j_status = 'posted' then
    raise exception 'orva_gl: lines of a posted journal are immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$orva$;`);
    this.addSql(`create trigger orva_gl_journal_line_guard_trg before insert or update or delete on "orva_gl_journal_lines" for each row execute function orva_gl_journal_line_guard();`);

    // Orva rule: every new tenant-scoped table gets RLS (see CLAUDE.md).
    this.addSql(`select orva_apply_rls();`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "orva_gl_journal_lines" cascade;`);
    this.addSql(`drop table if exists "orva_gl_journals" cascade;`);
    this.addSql(`drop table if exists "orva_gl_sequences" cascade;`);
    this.addSql(`drop table if exists "orva_fiscal_periods" cascade;`);
    this.addSql(`drop table if exists "orva_gl_accounts" cascade;`);
    this.addSql(`drop function if exists orva_gl_journal_guard();`);
    this.addSql(`drop function if exists orva_gl_journal_line_guard();`);
  }

}
