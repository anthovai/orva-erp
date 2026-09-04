import { Migration } from '@mikro-orm/migrations'

/**
 * PromptPay on collection documents: the ID the company registered with its
 * bank — a 10-digit phone, the 13-digit taxpayer id (juristic persons), or a
 * 15-digit e-wallet id. Set once; invoices and billing notes then carry a
 * scan-to-pay QR for the exact amount due.
 */
export class Migration20260904120000_promptpay extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table "orva_documents_settings" add column if not exists "promptpay_id" text null;')
    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('alter table "orva_documents_settings" drop column if exists "promptpay_id";')
  }
}
