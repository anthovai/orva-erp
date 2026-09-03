import { Migration } from '@mikro-orm/migrations'

/**
 * Brand profiles: one legal entity (the settings row), several trading brands
 * (Kaiser software, Marventine lotion …), each with its own logos, colour,
 * footer/terms, payment block and document-number series. A document belongs
 * to the brand whose code prefixes its number (MRV-QTN-2026001 → MRV), so no
 * column is needed on the upstream sales tables.
 */
export class Migration20260903220000_document_brands extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table "orva_document_brands" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "code" text not null,
      "name" text not null,
      "brand_color" text null,
      "logo_header" text null,
      "logo_footer" text null,
      "logo_header_quotation" text null,
      "payment_details" text null,
      "document_terms" text null,
      "quote_number_format" text null,
      "invoice_number_format" text null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_document_brands_pkey" primary key ("id"),
      constraint "orva_document_brands_code_check" check ("code" ~ '^[A-Z0-9]{2,6}$')
    );`)
    this.addSql('create index "orva_document_brands_tenant_org_idx" on "orva_document_brands" ("tenant_id", "organization_id");')
    this.addSql('create unique index "orva_document_brands_code_unique" on "orva_document_brands" ("tenant_id", "organization_id", "code") where "deleted_at" is null;')
    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "orva_document_brands";')
  }
}
