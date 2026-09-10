import { Migration } from '@mikro-orm/migrations'

/**
 * Marketplace order imports: which Shopee / Lazada / TikTok orders became
 * retail sales, so a second upload of the same export skips them, and which
 * failed and why.
 */
export class Migration20260910150000_marketplace_imports extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table "orva_stock_marketplace_imports" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "marketplace" text not null,
      "external_order_id" text not null,
      "status" text not null,
      "invoice_id" uuid null,
      "invoice_number" text null,
      "order_date" date null,
      "buyer_name" text null,
      "gross" numeric(18,2) null,
      "message" text null,
      "created_by" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      constraint "orva_stock_marketplace_imports_pkey" primary key ("id"),
      constraint "orva_stock_marketplace_imports_status_check" check ("status" in ('imported', 'failed'))
    );`)
    this.addSql('create index "orva_stock_marketplace_imports_tenant_org_idx" on "orva_stock_marketplace_imports" ("tenant_id", "organization_id");')
    // An order becomes a sale once. Failed attempts do not hold the slot, so
    // fixing the SKU and uploading again is allowed.
    this.addSql(`create unique index "orva_stock_marketplace_imports_order_unique"
      on "orva_stock_marketplace_imports" ("tenant_id", "marketplace", "external_order_id") where "status" = 'imported';`)

    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "orva_stock_marketplace_imports";')
  }
}
