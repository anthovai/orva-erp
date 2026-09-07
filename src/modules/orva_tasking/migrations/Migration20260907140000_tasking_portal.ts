import { Migration } from '@mikro-orm/migrations'

/**
 * Phase 3 of the tasking parity spec: what a customer may see.
 *
 * Publishing is an explicit act on a project, not a consequence of linking it
 * to a quotation, so `customer_visible` defaults to false and may only be true
 * where a quotation exists to scope it to.
 */
export class Migration20260907140000_tasking_portal extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table "orva_tasking_projects" add column "customer_visible" boolean not null default false;')
    this.addSql('alter table "orva_tasking_projects" add column "customer_label" text null;')
    this.addSql('alter table "orva_tasking_projects" add column "published_at" timestamptz null;')
    this.addSql('alter table "orva_tasking_projects" add column "published_by" uuid null;')
    // Nothing can be published without a quotation, because the quotation is
    // what says which customer may see it. Enforced here so no future route
    // can create a project the portal would have to guess the owner of.
    this.addSql(`alter table "orva_tasking_projects"
      add constraint "orva_tasking_projects_publish_check"
      check (not "customer_visible" or "quote_id" is not null);`)
    // The portal's own lookup: published projects for a given tenant.
    this.addSql(`create index "orva_tasking_projects_published_idx"
      on "orva_tasking_projects" ("tenant_id", "organization_id", "quote_id")
      where "customer_visible" and "deleted_at" is null;`)

    // A task inside a published project is what the customer came to see, so
    // this defaults to true — the opposite of comments and files, deliberately.
    // It is only ever read inside a published project.
    this.addSql('alter table "orva_tasking_tasks" add column "customer_visible" boolean not null default true;')

    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('alter table "orva_tasking_tasks" drop column if exists "customer_visible";')
    this.addSql('drop index if exists "orva_tasking_projects_published_idx";')
    this.addSql('alter table "orva_tasking_projects" drop constraint if exists "orva_tasking_projects_publish_check";')
    this.addSql('alter table "orva_tasking_projects" drop column if exists "published_by";')
    this.addSql('alter table "orva_tasking_projects" drop column if exists "published_at";')
    this.addSql('alter table "orva_tasking_projects" drop column if exists "customer_label";')
    this.addSql('alter table "orva_tasking_projects" drop column if exists "customer_visible";')
  }
}
