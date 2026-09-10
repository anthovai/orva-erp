import { Migration } from '@mikro-orm/migrations'

/**
 * The identity Thai payroll filing needs: ภ.ง.ด.1 wants the prefix and the
 * given/family name apart, สปส.1-10 wants the social-security number, 50 ทวิ
 * prints the address. Four of the columns are encrypted at rest by the
 * module's encryption map, so they are plain `text` here and hold ciphertext.
 *
 * Employer side: the social-security employer account and the person who signs
 * the return. The taxpayer id, branch and address stay in the document
 * settings, where the tax invoices already read them.
 */
export class Migration20260910200000_hr_statutory extends Migration {
  async up(): Promise<void> {
    this.addSql(`alter table "orva_hr_employees"
      add column if not exists "title_th" text null,
      add column if not exists "first_name_th" text null,
      add column if not exists "last_name_th" text null,
      add column if not exists "national_id" text null,
      add column if not exists "sso_number" text null,
      add column if not exists "address" text null,
      add column if not exists "bank_name" text null,
      add column if not exists "bank_account_no" text null,
      add column if not exists "termination_date" date null;`)

    this.addSql(`alter table "orva_hr_settings"
      add column if not exists "sso_employer_no" text null,
      add column if not exists "sso_branch_code" text null,
      add column if not exists "filer_name" text null,
      add column if not exists "filer_position" text null;`)

    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql(`alter table "orva_hr_employees"
      drop column if exists "title_th",
      drop column if exists "first_name_th",
      drop column if exists "last_name_th",
      drop column if exists "national_id",
      drop column if exists "sso_number",
      drop column if exists "address",
      drop column if exists "bank_name",
      drop column if exists "bank_account_no",
      drop column if exists "termination_date";`)
    this.addSql(`alter table "orva_hr_settings"
      drop column if exists "sso_employer_no",
      drop column if exists "sso_branch_code",
      drop column if exists "filer_name",
      drop column if exists "filer_position";`)
  }
}
