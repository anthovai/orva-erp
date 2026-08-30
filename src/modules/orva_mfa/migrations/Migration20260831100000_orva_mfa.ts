import { Migration } from '@mikro-orm/migrations';

export class Migration20260831100000_orva_mfa extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "orva_mfa_totp_credentials" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "user_id" uuid not null,
      "secret" text not null,
      "status" text not null default 'pending',
      "label" text null,
      "last_used_step" bigint null,
      "failed_attempts" int not null default 0,
      "locked_until" timestamptz null,
      "activated_at" timestamptz null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_mfa_totp_credentials_pkey" primary key ("id"),
      constraint "orva_mfa_totp_credentials_status_check" check ("status" in ('pending','active'))
    );`);
    this.addSql(`create index "orva_mfa_totp_credentials_tenant_org_idx" on "orva_mfa_totp_credentials" ("tenant_id", "organization_id");`);
    this.addSql(`create index "orva_mfa_totp_credentials_user_idx" on "orva_mfa_totp_credentials" ("user_id");`);
    this.addSql(`create unique index "orva_mfa_totp_credentials_active_user_unique" on "orva_mfa_totp_credentials" ("tenant_id", "user_id") where "deleted_at" is null;`);

    this.addSql(`create table "orva_mfa_recovery_codes" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "user_id" uuid not null,
      "code_hash" text not null,
      "used_at" timestamptz null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_mfa_recovery_codes_pkey" primary key ("id")
    );`);
    this.addSql(`create index "orva_mfa_recovery_codes_tenant_org_idx" on "orva_mfa_recovery_codes" ("tenant_id", "organization_id");`);
    this.addSql(`create index "orva_mfa_recovery_codes_user_idx" on "orva_mfa_recovery_codes" ("user_id");`);

    this.addSql(`create table "orva_mfa_session_flags" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "user_id" uuid not null,
      "session_id" uuid not null,
      "verified_at" timestamptz not null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      constraint "orva_mfa_session_flags_pkey" primary key ("id"),
      constraint "orva_mfa_session_flags_session_unique" unique ("session_id")
    );`);
    this.addSql(`create index "orva_mfa_session_flags_tenant_org_idx" on "orva_mfa_session_flags" ("tenant_id", "organization_id");`);
    this.addSql(`create index "orva_mfa_session_flags_user_idx" on "orva_mfa_session_flags" ("user_id");`);

    // Orva rule: every tenant-scoped table gets the RLS policy.
    this.addSql('select orva_apply_rls();');
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "orva_mfa_session_flags" cascade;');
    this.addSql('drop table if exists "orva_mfa_recovery_codes" cascade;');
    this.addSql('drop table if exists "orva_mfa_totp_credentials" cascade;');
  }
}
