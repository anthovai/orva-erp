import { Migration } from '@mikro-orm/migrations'

/** Standard terms (หมายเหตุ) printed on tax documents, from settings. */
export class Migration20260902150000_document_terms extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table "orva_documents_settings" add column if not exists "document_terms" text null;')
    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('alter table "orva_documents_settings" drop column if exists "document_terms";')
  }
}
