import { Migration } from '@mikro-orm/migrations'

/** Software / domain / hosting register with the renewal date that warns us. */
export class Migration20260904140000_support_subscriptions extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table "orva_support_subscriptions" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "name" text not null,
      "vendor" text null,
      "kind" text not null default 'software',
      "cost" numeric(18,4) not null default 0,
      "currency_code" text not null default 'THB',
      "billing_cycle" text not null default 'yearly',
      "renews_on" date null,
      "auto_renew" boolean not null default true,
      "expense_account_code" text null,
      "customer_entity_id" uuid null,
      "customer_name" text null,
      "quote_id" uuid null,
      "notes" text null,
      "status" text not null default 'active',
      "last_renewed_at" timestamptz null,
      "created_by" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_support_subscriptions_pkey" primary key ("id"),
      constraint "orva_support_subscriptions_kind_check" check ("kind" in ('software','domain','hosting','certificate','other')),
      constraint "orva_support_subscriptions_cycle_check" check ("billing_cycle" in ('monthly','quarterly','yearly','one_time')),
      constraint "orva_support_subscriptions_status_check" check ("status" in ('active','cancelled')),
      constraint "orva_support_subscriptions_cost_check" check ("cost" >= 0)
    );`)
    this.addSql('create index "orva_support_subscriptions_tenant_org_idx" on "orva_support_subscriptions" ("tenant_id", "organization_id");')
    this.addSql('create index "orva_support_subscriptions_renews_idx" on "orva_support_subscriptions" ("renews_on");')

    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "orva_support_subscriptions";')
  }
}
