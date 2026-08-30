import { Migration } from '@mikro-orm/migrations';

export class Migration20260830180000_orva_finance extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "orva_ar_receipts" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "receipt_no" text null,
      "status" text not null default 'draft',
      "customer_party_id" uuid null,
      "cash_account_id" uuid not null,
      "period_id" uuid not null,
      "receipt_date" date not null,
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
      constraint "orva_ar_receipts_pkey" primary key ("id"),
      constraint "orva_ar_receipts_status_check" check ("status" in ('draft','posted')),
      constraint "orva_ar_receipts_period_fk" foreign key ("period_id") references "orva_fiscal_periods" ("id"),
      constraint "orva_ar_receipts_cash_account_fk" foreign key ("cash_account_id") references "orva_gl_accounts" ("id"),
      constraint "orva_ar_receipts_journal_fk" foreign key ("journal_id") references "orva_gl_journals" ("id")
    );`);
    this.addSql(`create index "orva_ar_receipts_tenant_org_idx" on "orva_ar_receipts" ("tenant_id", "organization_id");`);
    this.addSql(`create unique index "orva_ar_receipts_active_no_unique" on "orva_ar_receipts" ("tenant_id", "receipt_no") where "deleted_at" is null and "receipt_no" is not null;`);

    this.addSql(`create table "orva_ar_receipt_allocations" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "receipt_id" uuid not null,
      "invoice_id" uuid not null,
      "amount" numeric(18,4) not null default 0,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_ar_receipt_allocations_pkey" primary key ("id"),
      constraint "orva_ar_receipt_allocations_receipt_fk" foreign key ("receipt_id") references "orva_ar_receipts" ("id"),
      constraint "orva_ar_receipt_allocations_amount_check" check ("amount" > 0)
    );`);
    this.addSql(`create index "orva_ar_receipt_allocations_tenant_org_idx" on "orva_ar_receipt_allocations" ("tenant_id", "organization_id");`);
    this.addSql(`create index "orva_ar_receipt_allocations_receipt_idx" on "orva_ar_receipt_allocations" ("receipt_id");`);
    this.addSql(`create index "orva_ar_receipt_allocations_invoice_idx" on "orva_ar_receipt_allocations" ("invoice_id");`);

    // Posted receipts are fully immutable and undeletable.
    this.addSql(`
create or replace function orva_ar_receipt_guard() returns trigger language plpgsql as $orva$
begin
  if tg_op = 'DELETE' then
    if old.status = 'posted' then
      raise exception 'orva_ar: posted receipt % cannot be deleted', old.receipt_no;
    end if;
    return old;
  end if;
  if old.status = 'posted' then
    raise exception 'orva_ar: posted receipt % is immutable', old.receipt_no;
  end if;
  return new;
end
$orva$;`);
    this.addSql(`create trigger orva_ar_receipt_guard_trg before update or delete on "orva_ar_receipts" for each row execute function orva_ar_receipt_guard();`);

    this.addSql(`
create or replace function orva_ar_receipt_allocation_guard() returns trigger language plpgsql as $orva$
declare
  r_status text;
begin
  select status into r_status from orva_ar_receipts where id = coalesce(new.receipt_id, old.receipt_id);
  if r_status = 'posted' then
    raise exception 'orva_ar: allocations of a posted receipt are immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$orva$;`);
    this.addSql(`create trigger orva_ar_receipt_allocation_guard_trg before insert or update or delete on "orva_ar_receipt_allocations" for each row execute function orva_ar_receipt_allocation_guard();`);

    // Orva rule: every new tenant-scoped table gets RLS (see CLAUDE.md).
    this.addSql(`select orva_apply_rls();`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "orva_ar_receipt_allocations" cascade;`);
    this.addSql(`drop table if exists "orva_ar_receipts" cascade;`);
    this.addSql(`drop function if exists orva_ar_receipt_guard();`);
    this.addSql(`drop function if exists orva_ar_receipt_allocation_guard();`);
  }

}
