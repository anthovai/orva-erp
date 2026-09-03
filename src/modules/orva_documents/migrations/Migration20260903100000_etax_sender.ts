import { Migration } from '@mikro-orm/migrations'

/** e-Tax Invoice by Email: the RD-registered sender address. */
export class Migration20260903100000_etax_sender extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table "orva_documents_settings" add column if not exists "etax_sender_email" text null;')
    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('alter table "orva_documents_settings" drop column if exists "etax_sender_email";')
  }
}
