import { Migration } from '@mikro-orm/migrations'

export class Migration20260901150000_brand_color extends Migration {
  async up(): Promise<void> {
    this.addSql(`alter table "orva_documents_settings" add column if not exists "brand_color" text not null default '#11836E';`)
    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('alter table "orva_documents_settings" drop column if exists "brand_color";')
  }
}
