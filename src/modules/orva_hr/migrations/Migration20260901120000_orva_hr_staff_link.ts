import { Migration } from '@mikro-orm/migrations';

/**
 * Employees ride on the installed staff registry instead of duplicating a
 * person registry in orva_party.
 *
 * - staff_member_id: scalar link to staff_team_members (no cross-module FK
 *   on purpose — staff rows soft-delete and the employment record must
 *   outlive them for payroll history).
 * - display_name: name snapshot so payslips and GL lines stay readable
 *   without a cross-module join. Backfilled from orva_parties for existing
 *   rows, which is why the party join can disappear from every reader.
 * - party_id becomes nullable: legacy rows keep it, new rows never write it.
 * - One employment record per staff member (soft-deleted rows exempt):
 *   payroll pays a person once.
 */
export class Migration20260901120000_orva_hr_staff_link extends Migration {

  override async up(): Promise<void> {
    this.addSql('alter table "orva_hr_employees" add column "staff_member_id" uuid null;');
    this.addSql('alter table "orva_hr_employees" add column "display_name" text null;');
    this.addSql('alter table "orva_hr_employees" alter column "party_id" drop not null;');
    this.addSql('create index "orva_hr_employees_staff_member_id_index" on "orva_hr_employees" ("staff_member_id");');
    this.addSql(`create unique index "orva_hr_employees_staff_member_unique"
      on "orva_hr_employees" ("tenant_id", "staff_member_id")
      where "deleted_at" is null and "staff_member_id" is not null;`);
    // Guarded because migrations run in module-name order, so orva_party — which
    // owns orva_parties — is applied AFTER orva_hr on a fresh database. Left
    // unguarded this failed every clean install with
    // `relation "orva_parties" does not exist`, while working on any database
    // where the table happened to predate it. There is nothing to backfill on a
    // fresh install anyway: the rows this repairs only exist on a database that
    // already ran orva_party.
    this.addSql(`do $$
      begin
        if to_regclass('public.orva_parties') is not null then
          update "orva_hr_employees" e
          set "display_name" = p."display_name"
          from "orva_parties" p
          where p."id" = e."party_id" and e."display_name" is null;
        end if;
      end $$;`);
    this.addSql('select orva_apply_rls();');
  }

  override async down(): Promise<void> {
    this.addSql('drop index if exists "orva_hr_employees_staff_member_unique";');
    this.addSql('drop index if exists "orva_hr_employees_staff_member_id_index";');
    this.addSql('alter table "orva_hr_employees" drop column if exists "staff_member_id";');
    this.addSql('alter table "orva_hr_employees" drop column if exists "display_name";');
  }
}
