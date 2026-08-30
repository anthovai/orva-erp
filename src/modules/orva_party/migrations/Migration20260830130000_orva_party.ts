import { Migration } from '@mikro-orm/migrations';

export class Migration20260830130000_orva_party extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "orva_parties" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "kind" text not null,
      "display_name" text not null,
      "legal_name" text null,
      "tax_id" text null,
      "email" text null,
      "phone" text null,
      "notes" text null,
      "created_by" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_parties_pkey" primary key ("id"),
      constraint "orva_parties_kind_check" check ("kind" in ('person', 'company'))
    );`);
    this.addSql(`create index "orva_parties_tenant_org_idx" on "orva_parties" ("tenant_id", "organization_id");`);
    this.addSql(`create index "orva_parties_display_name_idx" on "orva_parties" ("display_name");`);

    this.addSql(`create table "orva_party_roles" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "party_id" uuid not null,
      "role" text not null,
      "config_json" jsonb null,
      "created_by" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_party_roles_pkey" primary key ("id"),
      constraint "orva_party_roles_party_fk" foreign key ("party_id") references "orva_parties" ("id")
    );`);
    this.addSql(`create index "orva_party_roles_tenant_org_idx" on "orva_party_roles" ("tenant_id", "organization_id");`);
    this.addSql(`create index "orva_party_roles_party_idx" on "orva_party_roles" ("party_id");`);
    this.addSql(`create unique index "orva_party_roles_active_unique" on "orva_party_roles" ("tenant_id", "party_id", "role") where "deleted_at" is null;`);

    this.addSql(`create table "orva_party_links" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "party_id" uuid not null,
      "target_entity" text not null,
      "target_id" uuid not null,
      "created_by" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_party_links_pkey" primary key ("id"),
      constraint "orva_party_links_party_fk" foreign key ("party_id") references "orva_parties" ("id")
    );`);
    this.addSql(`create index "orva_party_links_tenant_org_idx" on "orva_party_links" ("tenant_id", "organization_id");`);
    this.addSql(`create index "orva_party_links_party_idx" on "orva_party_links" ("party_id");`);
    this.addSql(`create unique index "orva_party_links_active_target_unique" on "orva_party_links" ("tenant_id", "target_entity", "target_id") where "deleted_at" is null;`);

    // Orva rule: every new tenant-scoped table gets RLS (see CLAUDE.md).
    this.addSql(`select orva_apply_rls();`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "orva_party_links" cascade;`);
    this.addSql(`drop table if exists "orva_party_roles" cascade;`);
    this.addSql(`drop table if exists "orva_parties" cascade;`);
  }

}
