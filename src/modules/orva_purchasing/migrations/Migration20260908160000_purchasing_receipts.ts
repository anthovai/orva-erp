import { Migration } from '@mikro-orm/migrations'

/**
 * What actually arrived against an order.
 *
 * Append-only: a receipt is an event, and correcting one is a WMS adjustment
 * plus a reversing row, never an edit — which is why there is no `updated_at`
 * behaviour to guard and why `movement_id` is unique. That uniqueness is not
 * bookkeeping: it is what makes `orva_purchasing reconcile` idempotent when a
 * WMS receipt succeeded and this module's own write did not.
 */
export class Migration20260908160000_purchasing_receipts extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table "orva_purchasing_receipts" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "order_id" uuid not null,
      "order_line_id" uuid not null,
      "quantity" numeric(16,4) not null,
      "received_on" date not null,
      "movement_id" uuid null,
      "lot_id" uuid null,
      "lot_number" text null,
      "unit_cost" numeric(18,4) null,
      "memo" text null,
      "created_by" uuid null,
      "created_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_purchasing_receipts_pkey" primary key ("id"),
      constraint "orva_purchasing_receipts_order_fk"
        foreign key ("order_id") references "orva_purchasing_orders" ("id") on update cascade,
      constraint "orva_purchasing_receipts_line_fk"
        foreign key ("order_line_id") references "orva_purchasing_order_lines" ("id") on update cascade,
      constraint "orva_purchasing_receipts_qty_check" check ("quantity" > 0),
      constraint "orva_purchasing_receipts_cost_check" check ("unit_cost" is null or "unit_cost" >= 0)
    );`)
    this.addSql('create index "orva_purchasing_receipts_scope_idx" on "orva_purchasing_receipts" ("tenant_id", "organization_id");')
    this.addSql('create index "orva_purchasing_receipts_order_idx" on "orva_purchasing_receipts" ("order_id");')
    this.addSql('create index "orva_purchasing_receipts_line_idx" on "orva_purchasing_receipts" ("order_line_id");')
    // One receipt row per WMS movement, so a repair pass cannot double-count a
    // receipt it is recovering.
    this.addSql(`create unique index "orva_purchasing_receipts_movement_uq"
      on "orva_purchasing_receipts" ("movement_id")
      where "movement_id" is not null and "deleted_at" is null;`)

    // A receipt is history: it may be soft-deleted (a reversal), never edited.
    this.addSql(`create or replace function orva_purchasing_receipt_guard() returns trigger as $$
begin
  if new.quantity is distinct from old.quantity
     or new.order_line_id is distinct from old.order_line_id
     or new.movement_id is distinct from old.movement_id
     or new.received_on is distinct from old.received_on then
    raise exception 'orva_purchasing: a receipt is append-only; reverse it instead of editing it';
  end if;
  return new;
end $$ language plpgsql;`)
    this.addSql(`create trigger "orva_purchasing_receipts_guard"
      before update on "orva_purchasing_receipts"
      for each row execute function orva_purchasing_receipt_guard();`)

    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('drop trigger if exists "orva_purchasing_receipts_guard" on "orva_purchasing_receipts";')
    this.addSql('drop function if exists orva_purchasing_receipt_guard();')
    this.addSql('drop table if exists "orva_purchasing_receipts";')
  }
}
