import { Migration } from '@mikro-orm/migrations'

/**
 * What a vendor actually charged, against what was ordered.
 *
 * The link lives here and not on `orva_ap_bills` on purpose: finance owns the
 * liability and must stay ignorant of purchasing, so a bill without a purchase
 * order remains perfectly legal and dropping this module drops no column from
 * the ledger.
 *
 * One link per bill line — the unique index, not a convention. That is what
 * makes the link call idempotent (a repeat writes nothing) and what stops the
 * same charge being counted against two orders.
 */
export class Migration20260908210000_purchasing_bill_links extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table "orva_purchasing_bill_links" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "order_id" uuid not null,
      "order_line_id" uuid not null,
      "bill_id" uuid not null,
      "bill_line_id" uuid not null,
      "bill_line_no" int not null,
      "amount" numeric(18,4) not null,
      "created_by" uuid null,
      "created_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_purchasing_bill_links_pkey" primary key ("id"),
      constraint "orva_purchasing_bill_links_order_fk"
        foreign key ("order_id") references "orva_purchasing_orders" ("id") on update cascade,
      constraint "orva_purchasing_bill_links_line_fk"
        foreign key ("order_line_id") references "orva_purchasing_order_lines" ("id") on update cascade,
      constraint "orva_purchasing_bill_links_amount_check" check ("amount" >= 0)
    );`)
    this.addSql('create index "orva_purchasing_bill_links_scope_idx" on "orva_purchasing_bill_links" ("tenant_id", "organization_id");')
    this.addSql('create index "orva_purchasing_bill_links_order_idx" on "orva_purchasing_bill_links" ("order_id");')
    this.addSql('create index "orva_purchasing_bill_links_line_idx" on "orva_purchasing_bill_links" ("order_line_id");')
    this.addSql('create index "orva_purchasing_bill_links_bill_idx" on "orva_purchasing_bill_links" ("bill_id");')
    this.addSql(`create unique index "orva_purchasing_bill_links_bill_line_uq"
      on "orva_purchasing_bill_links" ("bill_line_id")
      where "deleted_at" is null;`)

    // A link records a fact about a bill that already exists: correcting it
    // means removing it and writing another, never editing the amount under
    // a variance somebody has already read.
    this.addSql(`create or replace function orva_purchasing_bill_link_guard() returns trigger as $$
begin
  if new.amount is distinct from old.amount
     or new.order_line_id is distinct from old.order_line_id
     or new.bill_line_id is distinct from old.bill_line_id then
    raise exception 'orva_purchasing: a bill link is append-only; unlink and link again instead';
  end if;
  return new;
end $$ language plpgsql;`)
    this.addSql(`create trigger "orva_purchasing_bill_links_guard"
      before update on "orva_purchasing_bill_links"
      for each row execute function orva_purchasing_bill_link_guard();`)

    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('drop trigger if exists "orva_purchasing_bill_links_guard" on "orva_purchasing_bill_links";')
    this.addSql('drop function if exists orva_purchasing_bill_link_guard();')
    this.addSql('drop table if exists "orva_purchasing_bill_links";')
  }
}
