import { Migration } from '@mikro-orm/migrations';

export class Migration20260830160000_orva_finance extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "orva_ap_bills" add column "paid_amount" numeric(18,4) not null default 0;`);
    this.addSql(`alter table "orva_ap_bills" add constraint "orva_ap_bills_paid_check" check ("paid_amount" >= 0);`);

    this.addSql(`create table "orva_ap_payments" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "payment_no" text null,
      "status" text not null default 'draft',
      "vendor_party_id" uuid not null,
      "cash_account_id" uuid not null,
      "period_id" uuid not null,
      "payment_date" date not null,
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
      constraint "orva_ap_payments_pkey" primary key ("id"),
      constraint "orva_ap_payments_status_check" check ("status" in ('draft','posted')),
      constraint "orva_ap_payments_period_fk" foreign key ("period_id") references "orva_fiscal_periods" ("id"),
      constraint "orva_ap_payments_cash_account_fk" foreign key ("cash_account_id") references "orva_gl_accounts" ("id"),
      constraint "orva_ap_payments_journal_fk" foreign key ("journal_id") references "orva_gl_journals" ("id")
    );`);
    this.addSql(`create index "orva_ap_payments_tenant_org_idx" on "orva_ap_payments" ("tenant_id", "organization_id");`);
    this.addSql(`create index "orva_ap_payments_vendor_idx" on "orva_ap_payments" ("vendor_party_id");`);
    this.addSql(`create unique index "orva_ap_payments_active_no_unique" on "orva_ap_payments" ("tenant_id", "payment_no") where "deleted_at" is null and "payment_no" is not null;`);

    this.addSql(`create table "orva_ap_payment_allocations" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "payment_id" uuid not null,
      "bill_id" uuid not null,
      "amount" numeric(18,4) not null default 0,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_ap_payment_allocations_pkey" primary key ("id"),
      constraint "orva_ap_payment_allocations_payment_fk" foreign key ("payment_id") references "orva_ap_payments" ("id"),
      constraint "orva_ap_payment_allocations_bill_fk" foreign key ("bill_id") references "orva_ap_bills" ("id"),
      constraint "orva_ap_payment_allocations_amount_check" check ("amount" > 0)
    );`);
    this.addSql(`create index "orva_ap_payment_allocations_tenant_org_idx" on "orva_ap_payment_allocations" ("tenant_id", "organization_id");`);
    this.addSql(`create index "orva_ap_payment_allocations_payment_idx" on "orva_ap_payment_allocations" ("payment_id");`);
    this.addSql(`create index "orva_ap_payment_allocations_bill_idx" on "orva_ap_payment_allocations" ("bill_id");`);

    // Relax the bill guard exactly as planned when payments landed: a posted
    // bill stays immutable EXCEPT for paid_amount (and updated_at), which the
    // payment-posting transaction maintains.
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
    if (to_jsonb(new) - 'paid_amount' - 'updated_at') is distinct from (to_jsonb(old) - 'paid_amount' - 'updated_at') then
      raise exception 'orva_ap: posted bill % is immutable (only paid_amount may change)', old.bill_no;
    end if;
    if new.paid_amount < 0 or new.paid_amount > new.total_amount then
      raise exception 'orva_ap: bill %: paid_amount % out of range (total %)', old.bill_no, new.paid_amount, new.total_amount;
    end if;
  end if;
  return new;
end
$orva$;`);

    // Posted payments are fully immutable and undeletable.
    this.addSql(`
create or replace function orva_ap_payment_guard() returns trigger language plpgsql as $orva$
begin
  if tg_op = 'DELETE' then
    if old.status = 'posted' then
      raise exception 'orva_ap: posted payment % cannot be deleted', old.payment_no;
    end if;
    return old;
  end if;
  if old.status = 'posted' then
    raise exception 'orva_ap: posted payment % is immutable', old.payment_no;
  end if;
  return new;
end
$orva$;`);
    this.addSql(`create trigger orva_ap_payment_guard_trg before update or delete on "orva_ap_payments" for each row execute function orva_ap_payment_guard();`);

    this.addSql(`
create or replace function orva_ap_payment_allocation_guard() returns trigger language plpgsql as $orva$
declare
  p_status text;
begin
  select status into p_status from orva_ap_payments where id = coalesce(new.payment_id, old.payment_id);
  if p_status = 'posted' then
    raise exception 'orva_ap: allocations of a posted payment are immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$orva$;`);
    this.addSql(`create trigger orva_ap_payment_allocation_guard_trg before insert or update or delete on "orva_ap_payment_allocations" for each row execute function orva_ap_payment_allocation_guard();`);

    // Orva rule: every new tenant-scoped table gets RLS (see CLAUDE.md).
    this.addSql(`select orva_apply_rls();`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "orva_ap_payment_allocations" cascade;`);
    this.addSql(`drop table if exists "orva_ap_payments" cascade;`);
    this.addSql(`drop function if exists orva_ap_payment_guard();`);
    this.addSql(`drop function if exists orva_ap_payment_allocation_guard();`);
    this.addSql(`alter table "orva_ap_bills" drop constraint if exists "orva_ap_bills_paid_check";`);
    this.addSql(`alter table "orva_ap_bills" drop column if exists "paid_amount";`);
  }

}
