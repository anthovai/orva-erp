import { Migration } from '@mikro-orm/migrations'

/**
 * Journals gain a metadata bag. The expense screen (ค่าใช้จ่ายจ่ายสด) has no
 * document of its own — the receipt is the document — so the journal itself
 * carries the payee, their taxpayer id and document number, the VAT/WHT split
 * and the screen that created it. The VAT and WHT registers read those keys,
 * which is why this is a column and not a note in the memo.
 */
export class Migration20260904100000_journal_metadata extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table "orva_gl_journals" add column if not exists "metadata" jsonb null;')
    this.addSql(`create index if not exists "orva_gl_journals_source_idx"
                 on "orva_gl_journals" ((metadata->>'source'))
                 where "metadata" is not null;`)
    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('drop index if exists "orva_gl_journals_source_idx";')
    this.addSql('alter table "orva_gl_journals" drop column if exists "metadata";')
  }
}
