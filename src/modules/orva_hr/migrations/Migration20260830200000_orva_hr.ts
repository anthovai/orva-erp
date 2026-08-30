import { Migration } from '@mikro-orm/migrations';

export class Migration20260830200000_orva_hr extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "orva_hr_employees" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "employee_no" text null,
      "party_id" uuid not null,
      "position" text null,
      "hire_date" date null,
      "monthly_salary" numeric(18,4) not null default 0,
      "wht_rate" numeric(5,2) not null default 0,
      "status" text not null default 'active',
      "created_by" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_hr_employees_pkey" primary key ("id"),
      constraint "orva_hr_employees_status_check" check ("status" in ('active','inactive')),
      constraint "orva_hr_employees_salary_check" check ("monthly_salary" >= 0),
      constraint "orva_hr_employees_wht_check" check ("wht_rate" >= 0 and "wht_rate" <= 100)
    );`);
    this.addSql(`create index "orva_hr_employees_tenant_org_idx" on "orva_hr_employees" ("tenant_id", "organization_id");`);
    this.addSql(`create index "orva_hr_employees_party_idx" on "orva_hr_employees" ("party_id");`);
    this.addSql(`create unique index "orva_hr_employees_active_no_unique" on "orva_hr_employees" ("tenant_id", "employee_no") where "deleted_at" is null and "employee_no" is not null;`);
    this.addSql(`create unique index "orva_hr_employees_active_party_unique" on "orva_hr_employees" ("tenant_id", "party_id") where "deleted_at" is null;`);

    this.addSql(`create table "orva_hr_payroll_runs" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "run_no" text null,
      "status" text not null default 'draft',
      "month_code" text not null,
      "period_id" uuid not null,
      "pay_date" date not null,
      "total_gross" numeric(18,4) not null default 0,
      "total_sso_employee" numeric(18,4) not null default 0,
      "total_sso_employer" numeric(18,4) not null default 0,
      "total_wht" numeric(18,4) not null default 0,
      "total_net" numeric(18,4) not null default 0,
      "engine_version" text null,
      "calculated_at" timestamptz null,
      "journal_id" uuid null,
      "posted_at" timestamptz null,
      "posted_by" uuid null,
      "created_by" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_hr_payroll_runs_pkey" primary key ("id"),
      constraint "orva_hr_payroll_runs_status_check" check ("status" in ('draft','calculated','posted'))
    );`);
    this.addSql(`create index "orva_hr_payroll_runs_tenant_org_idx" on "orva_hr_payroll_runs" ("tenant_id", "organization_id");`);
    this.addSql(`create unique index "orva_hr_payroll_runs_active_no_unique" on "orva_hr_payroll_runs" ("tenant_id", "run_no") where "deleted_at" is null and "run_no" is not null;`);
    this.addSql(`create unique index "orva_hr_payroll_runs_month_unique" on "orva_hr_payroll_runs" ("tenant_id", "organization_id", "month_code") where "deleted_at" is null;`);

    this.addSql(`create table "orva_hr_payroll_lines" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "run_id" uuid not null,
      "employee_id" uuid not null,
      "employee_no" text null,
      "employee_name" text not null,
      "gross" numeric(18,4) not null default 0,
      "sso_employee" numeric(18,4) not null default 0,
      "sso_employer" numeric(18,4) not null default 0,
      "wht" numeric(18,4) not null default 0,
      "net" numeric(18,4) not null default 0,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_hr_payroll_lines_pkey" primary key ("id"),
      constraint "orva_hr_payroll_lines_run_fk" foreign key ("run_id") references "orva_hr_payroll_runs" ("id"),
      constraint "orva_hr_payroll_lines_employee_fk" foreign key ("employee_id") references "orva_hr_employees" ("id")
    );`);
    this.addSql(`create index "orva_hr_payroll_lines_tenant_org_idx" on "orva_hr_payroll_lines" ("tenant_id", "organization_id");`);
    this.addSql(`create index "orva_hr_payroll_lines_run_idx" on "orva_hr_payroll_lines" ("run_id");`);

    this.addSql(`create table "orva_hr_settings" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "salary_expense_account_id" uuid not null,
      "sso_expense_account_id" uuid not null,
      "sso_payable_account_id" uuid not null,
      "tax_payable_account_id" uuid not null,
      "net_payable_account_id" uuid not null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      constraint "orva_hr_settings_pkey" primary key ("id")
    );`);
    this.addSql(`create unique index "orva_hr_settings_scope_unique" on "orva_hr_settings" ("tenant_id", "organization_id");`);

    this.addSql(`create table "orva_hr_sequences" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "kind" text not null,
      "next_value" bigint not null,
      constraint "orva_hr_sequences_pkey" primary key ("id")
    );`);
    this.addSql(`create unique index "orva_hr_sequences_scope_unique" on "orva_hr_sequences" ("tenant_id", "organization_id", "kind");`);

    // Posted payroll runs are immutable and undeletable.
    this.addSql(`
create or replace function orva_hr_payroll_run_guard() returns trigger language plpgsql as $orva$
begin
  if tg_op = 'DELETE' then
    if old.status = 'posted' then
      raise exception 'orva_hr: posted payroll run % cannot be deleted', old.run_no;
    end if;
    return old;
  end if;
  if old.status = 'posted' then
    raise exception 'orva_hr: posted payroll run % is immutable', old.run_no;
  end if;
  return new;
end
$orva$;`);
    this.addSql(`create trigger orva_hr_payroll_run_guard_trg before update or delete on "orva_hr_payroll_runs" for each row execute function orva_hr_payroll_run_guard();`);

    this.addSql(`
create or replace function orva_hr_payroll_line_guard() returns trigger language plpgsql as $orva$
declare
  r_status text;
begin
  select status into r_status from orva_hr_payroll_runs where id = coalesce(new.run_id, old.run_id);
  if r_status = 'posted' then
    raise exception 'orva_hr: lines of a posted payroll run are immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$orva$;`);
    this.addSql(`create trigger orva_hr_payroll_line_guard_trg before insert or update or delete on "orva_hr_payroll_lines" for each row execute function orva_hr_payroll_line_guard();`);

    // Orva rule: every new tenant-scoped table gets RLS (see CLAUDE.md).
    this.addSql(`select orva_apply_rls();`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "orva_hr_payroll_lines" cascade;`);
    this.addSql(`drop table if exists "orva_hr_payroll_runs" cascade;`);
    this.addSql(`drop table if exists "orva_hr_employees" cascade;`);
    this.addSql(`drop table if exists "orva_hr_settings" cascade;`);
    this.addSql(`drop table if exists "orva_hr_sequences" cascade;`);
    this.addSql(`drop function if exists orva_hr_payroll_run_guard();`);
    this.addSql(`drop function if exists orva_hr_payroll_line_guard();`);
  }

}
