import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

/**
 * Numbering and the accounts a new line defaults to. One row per
 * tenant/organization; `nextPoSeq` is advanced under a row lock at send time,
 * never at create time, so a draft that is never sent burns no number.
 */
@Entity({ tableName: 'orva_purchasing_settings' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class PurchasingSettings {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** Tokens: {yyyy} {yy} {mm} {dd} {seq:n}. See lib/numbering.ts. */
  @Property({ name: 'po_number_format', type: 'text', default: 'PO-{yyyy}{mm}-{seq:4}' })
  poNumberFormat: string = 'PO-{yyyy}{mm}-{seq:4}'

  /**
   * The date part the counter belongs to — the format rendered with the
   * sequence token removed. When the next send renders a different key, the
   * counter restarts at 1, which is what makes `PO-{yyyy}{mm}-…` monthly
   * rather than an ever-growing run.
   */
  @Property({ name: 'po_seq_period', type: 'text', nullable: true })
  poSeqPeriod?: string | null

  @Property({ name: 'next_po_seq', type: 'bigint', default: 1 })
  nextPoSeq: string = '1'

  /** GL account a goods line defaults to (usually 1200 สินค้าคงเหลือ). */
  @Property({ name: 'default_goods_account_id', type: 'uuid', nullable: true })
  defaultGoodsAccountId?: string | null

  /** GL account a service line defaults to. */
  @Property({ name: 'default_service_account_id', type: 'uuid', nullable: true })
  defaultServiceAccountId?: string | null

  /** 'none' | '7' — what a new line assumes. */
  @Property({ name: 'vat_default', type: 'text', default: '7' })
  vatDefault: string = '7'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

/**
 * ใบสั่งซื้อ — a commitment to buy stated lines from one vendor at stated
 * ex-VAT prices.
 *
 * `vendorPartyId` is a bare uuid into orva_party (the party must hold an
 * active 'vendor' role, checked when the order is written); cross-module
 * references stay FK-less per the framework rule. `vendorSnapshot` freezes
 * who the vendor was at send time so a later rename cannot rewrite a sheet
 * already in the vendor's inbox — it is encrypted at rest (encryption.ts) and
 * must be read through the decryption finders, never raw SQL.
 *
 * Money on this row is a cache of the lines, recomputed on every draft save.
 * The lines are the truth.
 */
@Entity({ tableName: 'orva_purchasing_orders' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class PurchaseOrder {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** Null while draft; claimed from the settings counter when sent. */
  @Property({ name: 'po_number', type: 'text', nullable: true })
  poNumber?: string | null

  /** draft | sent | partially_received | received | closed | cancelled */
  @Property({ type: 'text', default: 'draft' })
  status: string = 'draft'

  @Property({ name: 'vendor_party_id', type: 'uuid' })
  @Index()
  vendorPartyId!: string

  /** { name, legalName, taxId, branch, address, phone, email } at send time. */
  @Property({ name: 'vendor_snapshot', type: 'json', nullable: true })
  vendorSnapshot?: Record<string, unknown> | null

  @Property({ name: 'order_date', type: 'date' })
  orderDate!: string

  /** Header default for lines that state no date of their own. */
  @Property({ name: 'expected_on', type: 'date', nullable: true })
  expectedOn?: string | null

  @Property({ name: 'currency_code', type: 'text', default: 'THB' })
  currencyCode: string = 'THB'

  @Property({ name: 'subtotal', type: 'numeric', precision: 18, scale: 4, default: '0' })
  subtotal: string = '0'

  @Property({ name: 'tax_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  taxAmount: string = '0'

  @Property({ name: 'total_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  totalAmount: string = '0'

  @Property({ type: 'text', nullable: true })
  memo?: string | null

  /** The vendor's own quotation or order reference. */
  @Property({ name: 'vendor_reference', type: 'text', nullable: true })
  vendorReference?: string | null

  /** Why the order was closed short or cancelled — required by both routes. */
  @Property({ name: 'close_reason', type: 'text', nullable: true })
  closeReason?: string | null

  @Property({ name: 'sent_at', type: Date, nullable: true })
  sentAt?: Date | null

  @Property({ name: 'closed_at', type: Date, nullable: true })
  closedAt?: Date | null

  @Property({ name: 'cancelled_at', type: Date, nullable: true })
  cancelledAt?: Date | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  /** Optimistic-lock version: every mutation sends the value it read. */
  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * One thing ordered. `goods` carries a catalog variant and can be received
 * into WMS; `service` is free text and is fulfilled without touching stock.
 *
 * Once the order is sent, price, account, kind, variant and VAT mode are
 * frozen and the quantity may only rise (a real over-delivery), enforced in
 * the route and again by a database trigger. A quantity that should fall is a
 * short close, which records `shortQty` instead of rewriting the order.
 */
@Entity({ tableName: 'orva_purchasing_order_lines' })
@Index({ properties: ['tenantId', 'organizationId'] })
export class PurchaseOrderLine {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'order_id', type: 'uuid' })
  @Index()
  orderId!: string

  @Property({ name: 'line_no', type: 'int' })
  lineNo!: number

  /** goods | service */
  @Property({ type: 'text', default: 'goods' })
  kind: string = 'goods'

  @Property({ name: 'catalog_variant_id', type: 'uuid', nullable: true })
  @Index()
  catalogVariantId?: string | null

  /** Variant name at order time, or the service description. */
  @Property({ type: 'text' })
  description!: string

  @Property({ type: 'text', nullable: true })
  sku?: string | null

  @Property({ type: 'numeric', precision: 16, scale: 4 })
  quantity!: string

  /** ขวด, ชิ้น, ชั่วโมง — printed on the sheet, never computed with. */
  @Property({ type: 'text', nullable: true })
  unit?: string | null

  /** Ex-VAT price per unit. */
  @Property({ name: 'unit_price', type: 'numeric', precision: 18, scale: 4 })
  unitPrice!: string

  /** none | 7 — per line, because freight and goods can differ on one order. */
  @Property({ name: 'vat_mode', type: 'text', default: '7' })
  vatMode: string = '7'

  /** GL account the eventual bill line posts to. */
  @Property({ name: 'account_id', type: 'uuid' })
  accountId!: string

  @Property({ name: 'expected_on', type: 'date', nullable: true })
  @Index()
  expectedOn?: string | null

  /** ordered − received, frozen when the order is closed short. */
  @Property({ name: 'short_qty', type: 'numeric', precision: 16, scale: 4, nullable: true })
  shortQty?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
