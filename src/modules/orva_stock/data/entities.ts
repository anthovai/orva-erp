import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

/**
 * Cost of one received lot. WMS keeps quantities only; the money side lives
 * here: what the OEM bill charged per unit for that lot. `lotId` is a bare
 * uuid into wms_inventory_lots and `billId`/`billLineId` into orva_finance —
 * cross-module references stay FK-less per the framework rule.
 */
@Entity({ tableName: 'orva_stock_lot_costs' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class LotCost {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'lot_id', type: 'uuid' })
  @Index()
  lotId!: string

  @Property({ name: 'catalog_variant_id', type: 'uuid' })
  catalogVariantId!: string

  @Property({ name: 'received_qty', type: 'numeric', precision: 16, scale: 4 })
  receivedQty!: string

  /** Cost per unit excluding VAT (the bill's input VAT is a separate credit). */
  @Property({ name: 'unit_cost', type: 'numeric', precision: 18, scale: 4 })
  unitCost!: string

  @Property({ name: 'bill_id', type: 'uuid', nullable: true })
  billId?: string | null

  @Property({ name: 'bill_line_id', type: 'uuid', nullable: true })
  billLineId?: string | null

  /** The WMS receipt movement this cost belongs to. */
  @Property({ name: 'movement_id', type: 'uuid', nullable: true })
  movementId?: string | null

  @Property({ name: 'received_on', type: 'date' })
  receivedOn!: string

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * One stock issue (sale, sample, write-off) at the lot's cost — the COGS
 * ledger line waits here until the month is posted. `invoiceId` links the
 * retail sale's sales_invoice; `journalId` is set once posted.
 */
@Entity({ tableName: 'orva_stock_issues' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class StockIssue {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'lot_id', type: 'uuid' })
  @Index()
  lotId!: string

  @Property({ name: 'catalog_variant_id', type: 'uuid' })
  catalogVariantId!: string

  @Property({ type: 'numeric', precision: 16, scale: 4 })
  quantity!: string

  @Property({ name: 'unit_cost', type: 'numeric', precision: 18, scale: 4 })
  unitCost!: string

  /** 'sale' | 'sample' | 'write_off' */
  @Property({ type: 'text' })
  kind: string = 'sale'

  @Property({ name: 'issued_on', type: 'date' })
  issuedOn!: string

  @Property({ name: 'invoice_id', type: 'uuid', nullable: true })
  invoiceId?: string | null

  @Property({ name: 'movement_id', type: 'uuid', nullable: true })
  movementId?: string | null

  @Property({ name: 'journal_id', type: 'uuid', nullable: true })
  journalId?: string | null

  @Property({ type: 'text', nullable: true })
  memo?: string | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/** Which accounts inventory and cost of goods sold post to, plus the default warehouse/location. */
@Entity({ tableName: 'orva_stock_settings' })
export class StockSettings {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'inventory_account_id', type: 'uuid', nullable: true })
  inventoryAccountId?: string | null

  @Property({ name: 'cogs_account_id', type: 'uuid', nullable: true })
  cogsAccountId?: string | null

  @Property({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId?: string | null

  @Property({ name: 'location_id', type: 'uuid', nullable: true })
  locationId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
