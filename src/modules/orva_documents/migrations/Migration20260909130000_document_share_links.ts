import { Migration } from '@mikro-orm/migrations'

/**
 * Public links for documents that are not quotations.
 *
 * The quote link rides on the sales module's own acceptance token — one door,
 * and the public route serves only ใบเสนอราคา through it, because that token
 * authorises a quotation and nothing else. A ใบส่งของ prints from an invoice,
 * which carries no such token, so it needs a door of its own: a row per link,
 * storing only the token's hash (like sales does), scoped to the tenant, with
 * an expiry and a revocation so a link handed to a driver can be cut off.
 *
 * Which document types may pass through this door is decided in code
 * (`SHAREABLE_TYPES` in lib/document.ts), not here: today only the delivery
 * note, never a statutory tax document.
 */
export class Migration20260909130000_document_share_links extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table "orva_documents_share_links" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "source_kind" text not null,
      "source_id" uuid not null,
      "document_type" text not null,
      "token_hash" text not null,
      "expires_at" timestamptz null,
      "revoked_at" timestamptz null,
      "created_by" uuid null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      constraint "orva_documents_share_links_pkey" primary key ("id"),
      constraint "orva_documents_share_links_token_hash_unique" unique ("token_hash")
    );`)
    this.addSql('create index "orva_documents_share_links_tenant_org_idx" on "orva_documents_share_links" ("tenant_id", "organization_id");')
    this.addSql('create index "orva_documents_share_links_source_idx" on "orva_documents_share_links" ("source_kind", "source_id");')

    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "orva_documents_share_links";')
  }
}
