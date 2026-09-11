import { Migration } from '@mikro-orm/migrations'

/**
 * Two things a support desk needs once customers can reach it themselves.
 *
 * A ticket may now be opened from the portal, so 'portal' joins the sources a
 * ticket can have — the constraint is replaced rather than dropped, because
 * an unconstrained source column is how "portl" ends up in the data.
 *
 * Canned replies are the answers that get typed again every week. They belong
 * to the tenant, not to a ticket, and carry their own order so the operator
 * can put the common one first.
 */
export class Migration20260911100000_portal_and_canned extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table "orva_support_tickets" drop constraint if exists "orva_support_tickets_source_check";')
    this.addSql(`alter table "orva_support_tickets"
      add constraint "orva_support_tickets_source_check" check ("source" in ('manual', 'email', 'portal'));`)

    this.addSql(`create table "orva_support_canned_replies" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "title" text not null,
      "body" text not null,
      "position" integer not null default 0,
      "created_by" uuid null,
      "created_at" timestamptz not null,
      "updated_at" timestamptz not null,
      "deleted_at" timestamptz null,
      constraint "orva_support_canned_replies_pkey" primary key ("id")
    );`)
    this.addSql('create index "orva_support_canned_replies_tenant_org_idx" on "orva_support_canned_replies" ("tenant_id", "organization_id");')

    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "orva_support_canned_replies";')
    this.addSql('alter table "orva_support_tickets" drop constraint if exists "orva_support_tickets_source_check";')
    this.addSql(`alter table "orva_support_tickets"
      add constraint "orva_support_tickets_source_check" check ("source" in ('manual', 'email'));`)
  }
}
