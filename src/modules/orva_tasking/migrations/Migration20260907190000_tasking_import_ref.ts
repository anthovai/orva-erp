import { Migration } from '@mikro-orm/migrations'

/**
 * Where a record came from, when it was not typed into Orva.
 *
 * The importer needs this to be re-runnable: without a stable reference back
 * to the source row, a second run cannot tell "already imported" from "new",
 * and the only safe options are to import once and never again, or to
 * duplicate everything. Both are worse than one text column.
 *
 * Deliberately generic (`import_ref`, e.g. `kkg-tasking:task:412`) rather than
 * `vikunja_id`: the next thing worth importing will not be Vikunja, and a
 * column named after one source ages badly.
 */
export class Migration20260907190000_tasking_import_ref extends Migration {
  async up(): Promise<void> {
    for (const table of [
      'orva_tasking_projects',
      'orva_tasking_tasks',
      'orva_tasking_labels',
      'orva_tasking_task_comments',
      'orva_tasking_buckets',
    ]) {
      this.addSql(`alter table "${table}" add column "import_ref" text null;`)
      // Unique per tenant over live rows: re-importing finds the row it made
      // last time, and two tenants importing from the same source do not
      // collide.
      this.addSql(`create unique index "${table}_import_ref_unique"
        on "${table}" ("tenant_id", "import_ref")
        where "import_ref" is not null and "deleted_at" is null;`)
    }

    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    for (const table of [
      'orva_tasking_buckets',
      'orva_tasking_task_comments',
      'orva_tasking_labels',
      'orva_tasking_tasks',
      'orva_tasking_projects',
    ]) {
      this.addSql(`drop index if exists "${table}_import_ref_unique";`)
      this.addSql(`alter table "${table}" drop column if exists "import_ref";`)
    }
  }
}
