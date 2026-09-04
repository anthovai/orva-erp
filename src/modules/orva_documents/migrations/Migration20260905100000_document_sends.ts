import { Migration } from '@mikro-orm/migrations'

/**
 * Append-only log of documents actually emailed to a customer. Before this the
 * only trace was a log line, so "have I chased this invoice yet?" was
 * unanswerable — which is what collection reminders depend on.
 */
export class Migration20260905100000_document_sends extends Migration {
  async up(): Promise<void> {
    this.addSql(`create table "orva_documents_sends" (
      "id" uuid not null default gen_random_uuid(),
      "tenant_id" uuid not null,
      "organization_id" uuid not null,
      "document_type" text not null,
      "document_id" uuid null,
      "document_number" text null,
      "to_email" text not null,
      "file_name" text not null,
      "bytes" int not null default 0,
      "etax" boolean not null default false,
      "sent_by" uuid null,
      "sent_at" timestamptz not null,
      constraint "orva_documents_sends_pkey" primary key ("id"),
      constraint "orva_documents_sends_bytes_check" check ("bytes" >= 0)
    );`)
    this.addSql('create index "orva_documents_sends_tenant_org_idx" on "orva_documents_sends" ("tenant_id", "organization_id");')
    this.addSql('create index "orva_documents_sends_document_idx" on "orva_documents_sends" ("document_id");')
    this.addSql('create index "orva_documents_sends_sent_at_idx" on "orva_documents_sends" ("sent_at");')

    this.addSql('select orva_apply_rls();')
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "orva_documents_sends";')
  }
}
