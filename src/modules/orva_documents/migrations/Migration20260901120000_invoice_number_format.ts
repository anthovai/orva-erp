import { Migration } from '@mikro-orm/migrations'

export class Migration20260901120000_invoice_number_format extends Migration {
  async up(): Promise<void> {
    this.addSql(`alter table "orva_documents_settings" add column if not exists "invoice_number_format" text not null default 'INV-{yyyy}{mm}{dd}-{seq:5}';`)
    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('alter table "orva_documents_settings" drop column if exists "invoice_number_format";')
  }
}
