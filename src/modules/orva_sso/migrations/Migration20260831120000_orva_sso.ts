import { Migration } from '@mikro-orm/migrations';

export class Migration20260831120000_orva_sso extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "orva_sso_connections" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "name" text not null,
      "issuer_url" text not null,
      "client_id" text not null,
      "client_secret" text not null,
      "email_domains" text not null,
      "enabled" boolean not null default true,
      "created_by" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_sso_connections_pkey" primary key ("id")
    );`);
    this.addSql(`create index "orva_sso_connections_tenant_org_idx" on "orva_sso_connections" ("tenant_id", "organization_id");`);
    this.addSql(`create unique index "orva_sso_connections_active_name_unique" on "orva_sso_connections" ("tenant_id", "organization_id", "name") where "deleted_at" is null;`);

    // Orva rule: every tenant-scoped table gets the RLS policy.
    this.addSql('select orva_apply_rls();');
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "orva_sso_connections" cascade;');
  }
}
