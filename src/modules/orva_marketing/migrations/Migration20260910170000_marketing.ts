import { Migration } from '@mikro-orm/migrations'

/**
 * Broadcasts, their per-recipient send log, and the durable unsubscribe token
 * per contact. Consent itself is a custom field on the installed customer
 * record (orva/ce.ts), not a column here.
 */
export class Migration20260910170000_marketing extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table "orva_marketing_broadcasts" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "subject" text not null,
      "body" text not null,
      "status" text not null default 'draft',
      "audience_count" integer not null default 0,
      "sent_count" integer not null default 0,
      "failed_count" integer not null default 0,
      "sent_at" timestamptz null,
      "created_by" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_marketing_broadcasts_pkey" primary key ("id"),
      constraint "orva_marketing_broadcasts_status_check" check ("status" in ('draft','sending','sent','partial','failed'))
    );`)
    this.addSql('create index "orva_marketing_broadcasts_tenant_org_idx" on "orva_marketing_broadcasts" ("tenant_id", "organization_id");')

    this.addSql(`create table "orva_marketing_broadcast_recipients" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "broadcast_id" uuid not null,
      "customer_entity_id" uuid not null,
      "display_name" text not null,
      "email" text not null,
      "status" text not null default 'pending',
      "message_id" uuid null,
      "error" text null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      constraint "orva_marketing_broadcast_recipients_pkey" primary key ("id"),
      constraint "orva_marketing_broadcast_recipients_status_check" check ("status" in ('pending','sent','failed'))
    );`)
    this.addSql('create index "orva_marketing_broadcast_recipients_tenant_org_idx" on "orva_marketing_broadcast_recipients" ("tenant_id", "organization_id");')
    this.addSql('create index "orva_marketing_broadcast_recipients_broadcast_idx" on "orva_marketing_broadcast_recipients" ("broadcast_id");')

    this.addSql(`create table "orva_marketing_unsubscribe_tokens" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "customer_entity_id" uuid not null,
      "token" text not null,
      "used_at" timestamptz null,
      "created_at" timestamptz not null,
      constraint "orva_marketing_unsubscribe_tokens_pkey" primary key ("id"),
      constraint "orva_marketing_unsubscribe_tokens_token_unique" unique ("token"),
      constraint "orva_marketing_unsubscribe_tokens_contact_unique" unique ("tenant_id", "customer_entity_id")
    );`)
    this.addSql('create index "orva_marketing_unsubscribe_tokens_tenant_org_idx" on "orva_marketing_unsubscribe_tokens" ("tenant_id", "organization_id");')

    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "orva_marketing_unsubscribe_tokens";')
    this.addSql('drop table if exists "orva_marketing_broadcast_recipients";')
    this.addSql('drop table if exists "orva_marketing_broadcasts";')
  }
}
