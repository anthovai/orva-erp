import { Migration } from '@mikro-orm/migrations'

/**
 * ใบสั่งซื้อ: the commitment, its lines, and the counter that numbers it.
 *
 * The two triggers are not belt-and-braces decoration. Freezing a sent order
 * and forbidding a quantity to fall are the invariants the whole three-way
 * match rests on, and a guard that lives only in a route stops being a
 * guarantee the moment anything else writes the table — a CLI, a fix-up
 * script, a future module. They mirror the posted-bill guards orva_finance
 * installs for the same reason.
 */
export class Migration20260908100000_purchasing_orders extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table "orva_purchasing_settings" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "po_number_format" text not null default 'PO-{yyyy}{mm}-{seq:4}',
      "po_seq_period" text null,
      "next_po_seq" bigint not null default 1,
      "default_goods_account_id" uuid null,
      "default_service_account_id" uuid null,
      "vat_default" text not null default '7',
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      constraint "orva_purchasing_settings_pkey" primary key ("id"),
      constraint "orva_purchasing_settings_vat_check" check ("vat_default" in ('none','7')),
      constraint "orva_purchasing_settings_seq_check" check ("next_po_seq" >= 1)
    );`)
    this.addSql('create unique index "orva_purchasing_settings_scope_uq" on "orva_purchasing_settings" ("tenant_id", "organization_id");')

    this.addSql(`create table "orva_purchasing_orders" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "po_number" text null,
      "status" text not null default 'draft',
      "vendor_party_id" uuid not null,
      "vendor_snapshot" jsonb null,
      "order_date" date not null,
      "expected_on" date null,
      "currency_code" text not null default 'THB',
      "subtotal" numeric(18,4) not null default 0,
      "tax_amount" numeric(18,4) not null default 0,
      "total_amount" numeric(18,4) not null default 0,
      "memo" text null,
      "vendor_reference" text null,
      "close_reason" text null,
      "sent_at" timestamptz null,
      "closed_at" timestamptz null,
      "cancelled_at" timestamptz null,
      "created_by" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_purchasing_orders_pkey" primary key ("id"),
      constraint "orva_purchasing_orders_status_check"
        check ("status" in ('draft','sent','partially_received','received','closed','cancelled')),
      constraint "orva_purchasing_orders_amounts_check"
        check ("subtotal" >= 0 and "tax_amount" >= 0 and "total_amount" >= 0),
      -- A draft has no number and a sent order must have one. A cancelled
      -- order may be either: cancelling a draft never claimed a number,
      -- cancelling a sent order keeps the one it claimed.
      constraint "orva_purchasing_orders_number_check"
        check ("status" = 'cancelled'
               or ("status" = 'draft' and "po_number" is null)
               or ("status" <> 'draft' and "po_number" is not null))
    );`)
    this.addSql('create index "orva_purchasing_orders_scope_idx" on "orva_purchasing_orders" ("tenant_id", "organization_id");')
    this.addSql('create index "orva_purchasing_orders_vendor_idx" on "orva_purchasing_orders" ("vendor_party_id");')
    this.addSql('create index "orva_purchasing_orders_status_idx" on "orva_purchasing_orders" ("organization_id", "status");')
    // Numbers are unique per organization, and only among live rows, so a
    // deleted draft never blocks a series.
    this.addSql(`create unique index "orva_purchasing_orders_number_uq"
      on "orva_purchasing_orders" ("organization_id", "po_number")
      where "po_number" is not null and "deleted_at" is null;`)

    this.addSql(`create table "orva_purchasing_order_lines" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "order_id" uuid not null,
      "line_no" int not null,
      "kind" text not null default 'goods',
      "catalog_variant_id" uuid null,
      "description" text not null,
      "sku" text null,
      "quantity" numeric(16,4) not null,
      "unit" text null,
      "unit_price" numeric(18,4) not null,
      "vat_mode" text not null default '7',
      "account_id" uuid not null,
      "expected_on" date null,
      "short_qty" numeric(16,4) null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_purchasing_order_lines_pkey" primary key ("id"),
      constraint "orva_purchasing_order_lines_order_fk"
        foreign key ("order_id") references "orva_purchasing_orders" ("id") on update cascade,
      constraint "orva_purchasing_order_lines_kind_check" check ("kind" in ('goods','service')),
      constraint "orva_purchasing_order_lines_vat_check" check ("vat_mode" in ('none','7')),
      constraint "orva_purchasing_order_lines_qty_check" check ("quantity" > 0),
      constraint "orva_purchasing_order_lines_price_check" check ("unit_price" >= 0),
      -- Goods are receivable into WMS, which needs to know what to receive.
      constraint "orva_purchasing_order_lines_goods_check"
        check ("kind" <> 'goods' or "catalog_variant_id" is not null)
    );`)
    this.addSql('create index "orva_purchasing_order_lines_scope_idx" on "orva_purchasing_order_lines" ("tenant_id", "organization_id");')
    this.addSql('create index "orva_purchasing_order_lines_order_idx" on "orva_purchasing_order_lines" ("order_id");')
    this.addSql('create index "orva_purchasing_order_lines_variant_idx" on "orva_purchasing_order_lines" ("catalog_variant_id");')
    this.addSql('create index "orva_purchasing_order_lines_expected_idx" on "orva_purchasing_order_lines" ("expected_on");')
    this.addSql(`create unique index "orva_purchasing_order_lines_no_uq"
      on "orva_purchasing_order_lines" ("order_id", "line_no")
      where "deleted_at" is null;`)

    // Guard 1 — a sent order's lines are frozen, except a quantity that rises.
    this.addSql(`create or replace function orva_purchasing_line_guard() returns trigger as $$
declare
  order_status text;
begin
  select status into order_status from orva_purchasing_orders where id = new.order_id;
  if order_status is null or order_status = 'draft' then
    return new;
  end if;
  if new.unit_price is distinct from old.unit_price
     or new.account_id is distinct from old.account_id
     or new.kind is distinct from old.kind
     or new.catalog_variant_id is distinct from old.catalog_variant_id
     or new.vat_mode is distinct from old.vat_mode then
    raise exception 'orva_purchasing: line % is frozen once the order is sent', old.line_no;
  end if;
  if new.quantity < old.quantity then
    raise exception 'orva_purchasing: ordered quantity may only rise once the order is sent (line %)', old.line_no;
  end if;
  return new;
end $$ language plpgsql;`)
    this.addSql(`create trigger "orva_purchasing_order_lines_guard"
      before update on "orva_purchasing_order_lines"
      for each row execute function orva_purchasing_line_guard();`)

    // Guard 2 — a number, once claimed, belongs to that order forever, and a
    // settled order does not come back to life.
    this.addSql(`create or replace function orva_purchasing_order_guard() returns trigger as $$
begin
  if old.po_number is not null and new.po_number is distinct from old.po_number then
    raise exception 'orva_purchasing: a claimed PO number cannot be changed (%)', old.po_number;
  end if;
  if old.status in ('closed','cancelled') and new.status is distinct from old.status then
    raise exception 'orva_purchasing: order % is settled', coalesce(old.po_number, old.id::text);
  end if;
  return new;
end $$ language plpgsql;`)
    this.addSql(`create trigger "orva_purchasing_orders_guard"
      before update on "orva_purchasing_orders"
      for each row execute function orva_purchasing_order_guard();`)

    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('drop trigger if exists "orva_purchasing_orders_guard" on "orva_purchasing_orders";')
    this.addSql('drop trigger if exists "orva_purchasing_order_lines_guard" on "orva_purchasing_order_lines";')
    this.addSql('drop function if exists orva_purchasing_order_guard();')
    this.addSql('drop function if exists orva_purchasing_line_guard();')
    this.addSql('drop table if exists "orva_purchasing_order_lines";')
    this.addSql('drop table if exists "orva_purchasing_orders";')
    this.addSql('drop table if exists "orva_purchasing_settings";')
  }
}
