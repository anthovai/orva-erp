import { Migration } from '@mikro-orm/migrations'

/** Customer support tickets with a reply thread and time spent. */
export class Migration20260904090000_support_tickets extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table "orva_support_tickets" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "ticket_no" text not null,
      "subject" text not null,
      "description" text null,
      "kind" text not null default 'bug',
      "priority" text not null default 'normal',
      "status" text not null default 'open',
      "customer_entity_id" uuid null,
      "customer_name" text null,
      "contact_email" text null,
      "quote_id" uuid null,
      "due_on" date null,
      "minutes_spent" int not null default 0,
      "first_response_at" timestamptz null,
      "resolved_at" timestamptz null,
      "closed_at" timestamptz null,
      "created_by" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_support_tickets_pkey" primary key ("id"),
      constraint "orva_support_tickets_kind_check" check ("kind" in ('bug','question','change_request','incident')),
      constraint "orva_support_tickets_priority_check" check ("priority" in ('low','normal','high','urgent')),
      constraint "orva_support_tickets_status_check" check ("status" in ('open','in_progress','waiting_customer','resolved','closed'))
    );`)
    this.addSql('create index "orva_support_tickets_tenant_org_idx" on "orva_support_tickets" ("tenant_id", "organization_id");')
    this.addSql('create index "orva_support_tickets_customer_idx" on "orva_support_tickets" ("customer_entity_id");')
    this.addSql('create unique index "orva_support_tickets_no_unique" on "orva_support_tickets" ("tenant_id", "ticket_no") where "deleted_at" is null;')

    this.addSql(`create table "orva_support_replies" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "ticket_id" uuid not null references "orva_support_tickets" ("id"),
      "author" text not null default 'staff',
      "body" text not null,
      "minutes_spent" int not null default 0,
      "created_by" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_support_replies_pkey" primary key ("id"),
      constraint "orva_support_replies_author_check" check ("author" in ('staff','customer','note')),
      constraint "orva_support_replies_minutes_check" check ("minutes_spent" >= 0)
    );`)
    this.addSql('create index "orva_support_replies_ticket_idx" on "orva_support_replies" ("ticket_id");')

    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "orva_support_replies";')
    this.addSql('drop table if exists "orva_support_tickets";')
  }
}
