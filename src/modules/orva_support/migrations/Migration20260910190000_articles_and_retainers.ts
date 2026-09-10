import { Migration } from '@mikro-orm/migrations'

/**
 * H4: a small knowledge base the portal can read, and the retainer fields on
 * the subscription register (what to bill each cycle, and the last invoice
 * issued for it).
 */
export class Migration20260910190000_articles_and_retainers extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table "orva_support_articles" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "title" text not null,
      "slug" text not null,
      "summary" text null,
      "body" text not null,
      "tags" text[] null,
      "is_published" boolean not null default false,
      "position" integer not null default 0,
      "updated_by" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_support_articles_pkey" primary key ("id")
    );`)
    this.addSql('create index "orva_support_articles_tenant_org_idx" on "orva_support_articles" ("tenant_id", "organization_id");')
    // Unique among live rows only, so a deleted article frees its slug.
    this.addSql('create unique index "orva_support_articles_slug_unique" on "orva_support_articles" ("tenant_id", "organization_id", "slug") where "deleted_at" is null;')

    this.addSql('alter table "orva_support_subscriptions" add column if not exists "invoice_on_renewal" boolean not null default false;')
    this.addSql('alter table "orva_support_subscriptions" add column if not exists "retainer_amount" numeric(18,4) null;')
    this.addSql('alter table "orva_support_subscriptions" add column if not exists "last_invoice_id" uuid null;')
    this.addSql('alter table "orva_support_subscriptions" add column if not exists "last_invoice_number" text null;')
    this.addSql('alter table "orva_support_subscriptions" add column if not exists "last_invoiced_at" timestamptz null;')

    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "orva_support_articles";')
    this.addSql('alter table "orva_support_subscriptions" drop column if exists "invoice_on_renewal";')
    this.addSql('alter table "orva_support_subscriptions" drop column if exists "retainer_amount";')
    this.addSql('alter table "orva_support_subscriptions" drop column if exists "last_invoice_id";')
    this.addSql('alter table "orva_support_subscriptions" drop column if exists "last_invoice_number";')
    this.addSql('alter table "orva_support_subscriptions" drop column if exists "last_invoiced_at";')
  }
}
