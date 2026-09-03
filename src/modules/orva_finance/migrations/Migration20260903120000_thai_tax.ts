import { Migration } from '@mikro-orm/migrations'

/**
 * Thai tax handling in the ledger:
 * - AR: customers withhold 3% (ภาษีถูกหัก ณ ที่จ่าย) — a receipt books cash +
 *   WHT receivable against the invoice; settings name the asset account and
 *   a default bank account for automatic receipts from orva_documents.
 * - AP: vendor bills carry input VAT (ภาษีซื้อ) to its own asset account;
 *   payments withhold tax for the vendor (ภ.ง.ด.3/53) to a payable account.
 * - GL: reversal journals (ใบกลับรายการ) — the only way a posted journal is
 *   ever undone, so the audit trail keeps both entries.
 */
export class Migration20260903120000_thai_tax extends Migration {
  async up(): Promise<void> {
    // AR
    this.addSql('alter table "orva_ar_settings" add column if not exists "wht_receivable_account_id" uuid null references "orva_gl_accounts" ("id");')
    this.addSql('alter table "orva_ar_settings" add column if not exists "default_cash_account_id" uuid null references "orva_gl_accounts" ("id");')
    this.addSql('alter table "orva_ar_receipts" add column if not exists "wht_amount" numeric(18,4) not null default 0;')
    this.addSql('alter table "orva_ar_receipts" add column if not exists "wht_rate" numeric(6,2) null;')
    this.addSql('alter table "orva_ar_receipts" add column if not exists "source_invoice_id" uuid null;')
    this.addSql('alter table "orva_ar_receipts" add constraint "orva_ar_receipts_wht_check" check ("wht_amount" >= 0);')

    // AP
    this.addSql('alter table "orva_ap_settings" add column if not exists "input_vat_account_id" uuid null references "orva_gl_accounts" ("id");')
    this.addSql('alter table "orva_ap_settings" add column if not exists "wht_payable_account_id" uuid null references "orva_gl_accounts" ("id");')
    this.addSql('alter table "orva_ap_bills" add column if not exists "tax_amount" numeric(18,4) not null default 0;')
    this.addSql('alter table "orva_ap_bills" add constraint "orva_ap_bills_tax_check" check ("tax_amount" >= 0);')
    this.addSql('alter table "orva_ap_payments" add column if not exists "wht_amount" numeric(18,4) not null default 0;')
    this.addSql('alter table "orva_ap_payments" add column if not exists "wht_rate" numeric(6,2) null;')
    this.addSql('alter table "orva_ap_payments" add column if not exists "wht_type" text null;')
    this.addSql('alter table "orva_ap_payments" add column if not exists "wht_cert_no" text null;')
    this.addSql('alter table "orva_ap_payments" add constraint "orva_ap_payments_wht_check" check ("wht_amount" >= 0);')

    // GL reversal journals
    this.addSql('alter table "orva_gl_journals" drop constraint if exists "orva_gl_journals_kind_check";')
    this.addSql(`alter table "orva_gl_journals" add constraint "orva_gl_journals_kind_check" check ("journal_kind" in ('standard','closing','reversal'));`)
    this.addSql('alter table "orva_gl_journals" add column if not exists "reversal_of_id" uuid null references "orva_gl_journals" ("id");')
    // a posted journal can be reversed once — the reversal row carries the link
    this.addSql('create unique index if not exists "orva_gl_journals_reversal_unique" on "orva_gl_journals" ("reversal_of_id") where "reversal_of_id" is not null and "deleted_at" is null;')

    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('drop index if exists "orva_gl_journals_reversal_unique";')
    this.addSql('alter table "orva_gl_journals" drop column if exists "reversal_of_id";')
    this.addSql('alter table "orva_gl_journals" drop constraint if exists "orva_gl_journals_kind_check";')
    this.addSql(`alter table "orva_gl_journals" add constraint "orva_gl_journals_kind_check" check ("journal_kind" in ('standard','closing'));`)
    this.addSql('alter table "orva_ap_payments" drop constraint if exists "orva_ap_payments_wht_check";')
    this.addSql('alter table "orva_ap_payments" drop column if exists "wht_cert_no", drop column if exists "wht_type", drop column if exists "wht_rate", drop column if exists "wht_amount";')
    this.addSql('alter table "orva_ap_bills" drop constraint if exists "orva_ap_bills_tax_check";')
    this.addSql('alter table "orva_ap_bills" drop column if exists "tax_amount";')
    this.addSql('alter table "orva_ap_settings" drop column if exists "wht_payable_account_id", drop column if exists "input_vat_account_id";')
    this.addSql('alter table "orva_ar_receipts" drop constraint if exists "orva_ar_receipts_wht_check";')
    this.addSql('alter table "orva_ar_receipts" drop column if exists "source_invoice_id", drop column if exists "wht_rate", drop column if exists "wht_amount";')
    this.addSql('alter table "orva_ar_settings" drop column if exists "default_cash_account_id", drop column if exists "wht_receivable_account_id";')
  }
}
