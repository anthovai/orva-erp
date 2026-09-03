import { Migration } from '@mikro-orm/migrations'

/**
 * Marventine stock layer: cost per WMS lot, stock issues awaiting COGS
 * posting, and the accounts/warehouse defaults. Quantities stay in WMS.
 */
export class Migration20260903230000_orva_stock extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table "orva_stock_lot_costs" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "lot_id" uuid not null,
      "catalog_variant_id" uuid not null,
      "received_qty" numeric(16,4) not null,
      "unit_cost" numeric(18,4) not null,
      "bill_id" uuid null,
      "bill_line_id" uuid null,
      "movement_id" uuid null,
      "received_on" date not null,
      "created_by" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_stock_lot_costs_pkey" primary key ("id"),
      constraint "orva_stock_lot_costs_qty_check" check ("received_qty" > 0),
      constraint "orva_stock_lot_costs_cost_check" check ("unit_cost" >= 0)
    );`)
    this.addSql('create index "orva_stock_lot_costs_tenant_org_idx" on "orva_stock_lot_costs" ("tenant_id", "organization_id");')
    this.addSql('create index "orva_stock_lot_costs_lot_idx" on "orva_stock_lot_costs" ("lot_id");')

    this.addSql(`create table "orva_stock_issues" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "lot_id" uuid not null,
      "catalog_variant_id" uuid not null,
      "quantity" numeric(16,4) not null,
      "unit_cost" numeric(18,4) not null,
      "kind" text not null default 'sale',
      "issued_on" date not null,
      "invoice_id" uuid null,
      "movement_id" uuid null,
      "journal_id" uuid null,
      "memo" text null,
      "created_by" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_stock_issues_pkey" primary key ("id"),
      constraint "orva_stock_issues_qty_check" check ("quantity" > 0),
      constraint "orva_stock_issues_kind_check" check ("kind" in ('sale','sample','write_off'))
    );`)
    this.addSql('create index "orva_stock_issues_tenant_org_idx" on "orva_stock_issues" ("tenant_id", "organization_id");')
    this.addSql('create index "orva_stock_issues_lot_idx" on "orva_stock_issues" ("lot_id");')
    this.addSql('create index "orva_stock_issues_issued_on_idx" on "orva_stock_issues" ("tenant_id", "organization_id", "issued_on");')

    this.addSql(`create table "orva_stock_settings" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "inventory_account_id" uuid null,
      "cogs_account_id" uuid null,
      "warehouse_id" uuid null,
      "location_id" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      constraint "orva_stock_settings_pkey" primary key ("id"),
      constraint "orva_stock_settings_scope_unique" unique ("tenant_id", "organization_id")
    );`)

    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "orva_stock_issues";')
    this.addSql('drop table if exists "orva_stock_lot_costs";')
    this.addSql('drop table if exists "orva_stock_settings";')
  }
}
