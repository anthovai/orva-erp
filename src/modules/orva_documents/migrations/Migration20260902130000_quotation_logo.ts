import { Migration } from '@mikro-orm/migrations'

/** Separate header logo for quotations (billing documents keep logo_header). */
export class Migration20260902130000_quotation_logo extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table "orva_documents_settings" add column if not exists "logo_header_quotation" text null;')
    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('alter table "orva_documents_settings" drop column if exists "logo_header_quotation";')
  }
}
