import { Migration } from '@mikro-orm/migrations'

/**
 * Where a ticket came from, and which mail thread it belongs to, so a reply
 * can be routed back onto the same conversation instead of starting a new one.
 */
export class Migration20260905130000_ticket_email_source extends Migration {
  async up(): Promise<void> {
    this.addSql(`alter table "orva_support_tickets"
      add column "source" text not null default 'manual',
      add column "thread_id" text null,
      add column "source_email_id" uuid null;`)
    this.addSql(`alter table "orva_support_tickets"
      add constraint "orva_support_tickets_source_check" check ("source" in ('manual', 'email'));`)
    this.addSql('create index "orva_support_tickets_thread_idx" on "orva_support_tickets" ("thread_id");')
    // One ticket per ingested email: a redelivery appends a reply instead of
    // opening a second ticket, and this makes that a database guarantee
    // rather than a hope about worker retries.
    this.addSql('create unique index "orva_support_tickets_source_email_unique" on "orva_support_tickets" ("tenant_id", "source_email_id") where "source_email_id" is not null;')

    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('drop index if exists "orva_support_tickets_source_email_unique";')
    this.addSql('drop index if exists "orva_support_tickets_thread_idx";')
    this.addSql('alter table "orva_support_tickets" drop constraint if exists "orva_support_tickets_source_check";')
    this.addSql('alter table "orva_support_tickets" drop column if exists "source_email_id", drop column if exists "thread_id", drop column if exists "source";')
  }
}
