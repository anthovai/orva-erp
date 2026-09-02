import { Migration } from '@mikro-orm/migrations'

/**
 * The การชำระเงิน block (bank account + terms) the tenant's paper prints on
 * every document. Hand-written single-column add — db:generate's snapshot
 * drift makes its output untrustworthy here.
 */
export class Migration20260902090000_payment_details extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table "orva_documents_settings" add column if not exists "payment_details" text null;')
    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('alter table "orva_documents_settings" drop column if exists "payment_details";')
  }
}
