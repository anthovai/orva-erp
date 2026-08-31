import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

/**
 * Seller identity printed on every document, plus the default template per
 * document type. One row per tenant/organization — a tenant operating several
 * legal entities keeps one row per organization.
 */
@Entity({ tableName: 'orva_documents_settings' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class DocumentSettings {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'seller_name', type: 'text' })
  sellerName!: string

  @Property({ name: 'seller_legal_name', type: 'text', nullable: true })
  sellerLegalName?: string | null

  /** 13-digit taxpayer id — required for a valid Thai tax invoice. */
  @Property({ name: 'seller_tax_id', type: 'text', nullable: true })
  sellerTaxId?: string | null

  /** "สำนักงานใหญ่" or a 5-digit branch code. */
  @Property({ name: 'seller_branch', type: 'text', nullable: true })
  sellerBranch?: string | null

  @Property({ name: 'seller_address', type: 'text', nullable: true })
  sellerAddress?: string | null

  @Property({ name: 'seller_phone', type: 'text', nullable: true })
  sellerPhone?: string | null

  @Property({ name: 'seller_email', type: 'text', nullable: true })
  sellerEmail?: string | null

  @Property({ name: 'template_quotation', type: 'text', default: 'classic' })
  templateQuotation: string = 'classic'

  @Property({ name: 'template_invoice', type: 'text', default: 'classic' })
  templateInvoice: string = 'classic'

  @Property({ name: 'template_tax_invoice', type: 'text', default: 'classic' })
  templateTaxInvoice: string = 'classic'

  @Property({ name: 'template_receipt', type: 'text', default: 'classic' })
  templateReceipt: string = 'classic'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt?: Date | null

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
