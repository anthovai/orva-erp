import { Migration } from '@mikro-orm/migrations'

/**
 * Whether a staff reply went back to the client by email, and through which
 * message. A failed send keeps the reply and records why, so the screen can
 * say "saved, but the email did not go" instead of losing the words.
 */
export class Migration20260910120000_reply_email extends Migration {
  async up(): Promise<void> {
    this.addSql(`alter table "orva_support_replies"
      add column "email_message_id" uuid null,
      add column "email_status" text null,
      add column "email_error" text null;`)
    this.addSql(`alter table "orva_support_replies"
      add constraint "orva_support_replies_email_status_check" check ("email_status" is null or "email_status" in ('sent', 'failed'));`)

    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('alter table "orva_support_replies" drop constraint if exists "orva_support_replies_email_status_check";')
    this.addSql('alter table "orva_support_replies" drop column if exists "email_error", drop column if exists "email_status", drop column if exists "email_message_id";')
  }
}
