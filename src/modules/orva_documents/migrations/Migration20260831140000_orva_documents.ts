import { Migration } from '@mikro-orm/migrations';

export class Migration20260831140000_orva_documents extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "orva_documents_settings" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "seller_name" text not null,
      "seller_legal_name" text null,
      "seller_tax_id" text null,
      "seller_branch" text null,
      "seller_address" text null,
      "seller_phone" text null,
      "seller_email" text null,
      "template_quotation" text not null default 'classic',
      "template_invoice" text not null default 'classic',
      "template_tax_invoice" text not null default 'classic',
      "template_receipt" text not null default 'classic',
      "created_at" timestamptz not null,
      "updated_at" timestamptz null,
      "deleted_at" timestamptz null,
      constraint "orva_documents_settings_pkey" primary key ("id")
    );`);
    this.addSql(`create index "orva_documents_settings_tenant_org_idx" on "orva_documents_settings" ("tenant_id", "organization_id");`);
    this.addSql(`create unique index "orva_documents_settings_scope_unique" on "orva_documents_settings" ("tenant_id", "organization_id") where "deleted_at" is null;`);

    // Orva rule: every tenant-scoped table gets the RLS policy.
    this.addSql('select orva_apply_rls();');
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "orva_documents_settings" cascade;');
  }
}
