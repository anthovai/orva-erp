import { Migration } from '@mikro-orm/migrations'

/**
 * โปรเจกต์ economics: a company-default hourly rate on the document settings
 * and an optional per-quote override, so logged minutes become cost and margin.
 */
export class Migration20260910180000_project_rates extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table "orva_documents_settings" add column if not exists "default_hourly_rate" numeric(12,2) null;')
    this.addSql(`create table "orva_documents_project_rates" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "quote_id" uuid not null,
      "hourly_rate" numeric(12,2) not null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      constraint "orva_documents_project_rates_pkey" primary key ("id"),
      constraint "orva_documents_project_rates_quote_unique" unique ("tenant_id", "quote_id"),
      constraint "orva_documents_project_rates_rate_check" check ("hourly_rate" >= 0)
    );`)
    this.addSql('create index "orva_documents_project_rates_tenant_org_idx" on "orva_documents_project_rates" ("tenant_id", "organization_id");')
    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "orva_documents_project_rates";')
    this.addSql('alter table "orva_documents_settings" drop column if exists "default_hourly_rate";')
  }
}
