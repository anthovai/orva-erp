import { Migration } from '@mikro-orm/migrations'

/**
 * ชุดปิดเดือน — the monthly hand-off to the outsourced accounting firm.
 * One row per generated pack (history is kept: a re-send after a correction
 * is a new row), plus the accountant's address on the GL settings row so the
 * owner types it once.
 */
export class Migration20260903200000_month_pack extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table "orva_gl_settings" add column "accountant_email" text null, add column "accountant_name" text null;')

    this.addSql(`create table "orva_month_packs" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "month" text not null,
      "status" text not null default 'generated',
      "file_name" text not null,
      "file_size" int not null default 0,
      "sent_to" text null,
      "sent_at" timestamptz null,
      "summary" jsonb null,
      "created_by" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_month_packs_pkey" primary key ("id"),
      constraint "orva_month_packs_status_check" check ("status" in ('generated','sent','failed')),
      constraint "orva_month_packs_month_check" check ("month" ~ '^[0-9]{4}-[0-9]{2}$')
    );`)
    this.addSql('create index "orva_month_packs_tenant_month_idx" on "orva_month_packs" ("tenant_id", "organization_id", "month");')

    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "orva_month_packs";')
    this.addSql('alter table "orva_gl_settings" drop column if exists "accountant_email", drop column if exists "accountant_name";')
  }
}
