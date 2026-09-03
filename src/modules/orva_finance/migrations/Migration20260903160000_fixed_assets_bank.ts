import { Migration } from '@mikro-orm/migrations'

/**
 * Fixed-asset register with monthly straight-line depreciation runs, and bank
 * statement lines for reconciliation against the ledger.
 */
export class Migration20260903160000_fixed_assets_bank extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table "orva_fa_assets" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "code" text null,
      "name" text not null,
      "category" text null,
      "acquired_on" date not null,
      "cost" numeric(18,4) not null default 0,
      "salvage" numeric(18,4) not null default 0,
      "useful_life_months" int not null,
      "asset_account_id" uuid not null references "orva_gl_accounts" ("id"),
      "accum_depr_account_id" uuid not null references "orva_gl_accounts" ("id"),
      "expense_account_id" uuid not null references "orva_gl_accounts" ("id"),
      "status" text not null default 'active',
      "disposed_on" date null,
      "notes" text null,
      "created_by" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_fa_assets_pkey" primary key ("id"),
      constraint "orva_fa_assets_status_check" check ("status" in ('active','disposed')),
      constraint "orva_fa_assets_life_check" check ("useful_life_months" > 0),
      constraint "orva_fa_assets_cost_check" check ("cost" >= "salvage" and "salvage" >= 0)
    );`)
    this.addSql('create index "orva_fa_assets_tenant_org_idx" on "orva_fa_assets" ("tenant_id", "organization_id");')
    this.addSql('create unique index "orva_fa_assets_code_unique" on "orva_fa_assets" ("tenant_id", "code") where "deleted_at" is null and "code" is not null;')

    this.addSql(`create table "orva_fa_depreciations" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "asset_id" uuid not null references "orva_fa_assets" ("id"),
      "period_id" uuid not null references "orva_fiscal_periods" ("id"),
      "amount" numeric(18,4) not null,
      "journal_id" uuid not null references "orva_gl_journals" ("id"),
      "created_by" uuid null,
      "created_at" timestamptz not null,
      constraint "orva_fa_depreciations_pkey" primary key ("id")
    );`)
    // one depreciation per asset per period, at the database
    this.addSql('create unique index "orva_fa_depreciations_asset_period_unique" on "orva_fa_depreciations" ("asset_id", "period_id");')
    this.addSql('create index "orva_fa_depreciations_tenant_org_idx" on "orva_fa_depreciations" ("tenant_id", "organization_id");')

    this.addSql(`create table "orva_bank_statement_lines" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "account_id" uuid not null references "orva_gl_accounts" ("id"),
      "batch_id" uuid not null,
      "txn_date" date not null,
      "description" text null,
      "reference" text null,
      "amount" numeric(18,4) not null,
      "status" text not null default 'unmatched',
      "journal_line_id" uuid null references "orva_gl_journal_lines" ("id"),
      "created_by" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_bank_statement_lines_pkey" primary key ("id"),
      constraint "orva_bank_statement_lines_status_check" check ("status" in ('unmatched','matched','excluded'))
    );`)
    this.addSql('create index "orva_bank_statement_lines_account_idx" on "orva_bank_statement_lines" ("tenant_id", "account_id", "status");')
    // a ledger line can back at most one statement line
    this.addSql('create unique index "orva_bank_statement_lines_journal_line_unique" on "orva_bank_statement_lines" ("journal_line_id") where "journal_line_id" is not null and "deleted_at" is null;')

    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "orva_bank_statement_lines" cascade;')
    this.addSql('drop table if exists "orva_fa_depreciations" cascade;')
    this.addSql('drop table if exists "orva_fa_assets" cascade;')
  }
}
