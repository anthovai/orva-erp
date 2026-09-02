import { Migration } from '@mikro-orm/migrations'

/** Header and footer logos (image data URIs) printed on the documents. */
export class Migration20260902110000_logos extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table "orva_documents_settings" add column if not exists "logo_header" text null;')
    this.addSql('alter table "orva_documents_settings" add column if not exists "logo_footer" text null;')
    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('alter table "orva_documents_settings" drop column if exists "logo_header";')
    this.addSql('alter table "orva_documents_settings" drop column if exists "logo_footer";')
  }
}
