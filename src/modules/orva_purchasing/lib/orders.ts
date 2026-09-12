import type { EntityManager } from '@mikro-orm/postgresql'
import { PurchaseOrder, PurchaseOrderLine, PurchasingSettings } from '../data/entities'
import type { LineInput } from '../data/validators'
import { computeTotals, type VatMode } from './totals'
import type { PurchaseOrderEvent } from '../events'

export type Scope = { tenantId: string; organizationId: string }

/** An error the route turns straight into a status code and a Thai message. */
export function fail(status: number, message: string, code?: string): Error {
  return Object.assign(new Error(message), { status, code })
}

/**
 * A party may only be ordered from while it actually holds the vendor role.
 * Checked on every write rather than at create only: a role revoked between
 * drafting and sending should stop the send.
 */
export async function assertVendorRole(tem: EntityManager, scope: Scope, partyId: string): Promise<void> {
  // The PARTY is scoped here too, not just the role row. The role carries its
  // own tenant and organization, so scoping only the role would accept a role
  // row minted in this organization that points at another one's party — the
  // party-roles route now refuses to create such a row, and this is the second
  // lock on the same door, on the path where the money is actually committed.
  const rows = (await tem.execute(
    `select 1 as ok
       from orva_party_roles r
       join orva_parties p
         on p.id = r.party_id and p.deleted_at is null
        and p.tenant_id = r.tenant_id and p.organization_id = r.organization_id
      where r.party_id = ?::uuid and r.role = 'vendor' and r.deleted_at is null
        and r.tenant_id = ?::uuid and r.organization_id = ?::uuid
      limit 1`,
    [partyId, scope.tenantId, scope.organizationId],
  )) as Array<{ ok: number }>
  if (!rows.length) {
    throw fail(400, 'คู่ค้ารายนี้ยังไม่ได้ตั้งเป็นผู้ขาย — เพิ่มบทบาท "ผู้ขาย" ในทะเบียนคู่ค้าก่อน', 'not_a_vendor')
  }
}

/** Vendor identity as printed on the sheet, read live and frozen at send. */
export async function vendorSnapshotFor(
  tem: EntityManager,
  scope: Scope,
  partyId: string,
): Promise<Record<string, unknown>> {
  const rows = (await tem.execute(
    `select display_name, legal_name, tax_id, email, phone
       from orva_parties
      where id = ?::uuid and tenant_id = ?::uuid and organization_id = ?::uuid and deleted_at is null`,
    [partyId, scope.tenantId, scope.organizationId],
  )) as Array<{ display_name: string; legal_name: string | null; tax_id: string | null; email: string | null; phone: string | null }>
  const row = rows[0]
  if (!row) throw fail(404, 'ไม่พบคู่ค้ารายนี้', 'vendor_missing')
  return {
    name: row.display_name,
    legalName: row.legal_name,
    taxId: row.tax_id,
    email: row.email,
    phone: row.phone,
  }
}

const asVat = (mode: string): VatMode => (mode === 'none' ? 'none' : '7')

/** Money on the order row is a cache of its lines; this is the only writer. */
export function applyTotals(order: PurchaseOrder, lines: Array<{ quantity: number; unitPrice: number; vatMode: string }>): void {
  const totals = computeTotals(lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, vatMode: asVat(l.vatMode) })))
  order.subtotal = totals.subtotal.toFixed(4)
  order.taxAmount = totals.taxAmount.toFixed(4)
  order.totalAmount = totals.total.toFixed(4)
}

/**
 * Writes the order's lines from scratch: existing rows are soft-deleted and
 * replaced, numbered from 1. Only ever called on a draft, where line
 * membership is still open.
 */
export async function replaceLines(
  tem: EntityManager,
  scope: Scope,
  order: PurchaseOrder,
  lines: LineInput[],
  now: Date,
): Promise<void> {
  const existing = await tem.find(PurchaseOrderLine, { orderId: order.id, tenantId: scope.tenantId, deletedAt: null })
  for (const line of existing) {
    line.deletedAt = now
    line.updatedAt = now
  }
  lines.forEach((input, index) => {
    tem.persist(
      tem.create(PurchaseOrderLine, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        orderId: order.id,
        lineNo: index + 1,
        kind: input.kind,
        catalogVariantId: input.kind === 'goods' ? (input.catalogVariantId ?? null) : null,
        description: input.description,
        sku: input.sku ?? null,
        quantity: input.quantity.toFixed(4),
        unit: input.unit ?? null,
        unitPrice: input.unitPrice.toFixed(4),
        vatMode: input.vatMode,
        accountId: input.accountId,
        expectedOn: input.expectedOn ?? order.expectedOn ?? null,
        createdAt: now,
        updatedAt: now,
      }),
    )
  })
  applyTotals(order, lines)
}

/** Settings, created on first read so an organization never lacks a counter. */
export async function loadSettings(tem: EntityManager, scope: Scope): Promise<PurchasingSettings> {
  const existing = await tem.findOne(PurchasingSettings, { tenantId: scope.tenantId, organizationId: scope.organizationId })
  if (existing) return existing
  const created = tem.create(PurchasingSettings, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    poNumberFormat: 'PO-{yyyy}{mm}-{seq:4}',
    poSeqPeriod: null,
    nextPoSeq: '1',
    defaultGoodsAccountId: null,
    defaultServiceAccountId: null,
    vatDefault: '7',
    createdAt: new Date(),
    updatedAt: new Date(),
  })
  tem.persist(created)
  await tem.flush()
  return created
}

/** The payload every order event carries. */
export function orderEvent(order: PurchaseOrder): PurchaseOrderEvent {
  return {
    id: order.id,
    tenantId: order.tenantId,
    organizationId: order.organizationId,
    poNumber: order.poNumber ?? null,
    status: order.status,
    vendorPartyId: order.vendorPartyId,
    totalAmount: order.totalAmount,
    updatedAt: order.updatedAt.toISOString(),
  }
}

/**
 * Optimistic locking, one comparison in one place: the client sends the
 * `updatedAt` it rendered, and a mismatch is a 409 rather than a silent
 * overwrite of somebody else's edit.
 */
export function assertVersion(order: PurchaseOrder, updatedAt: string): void {
  if (order.updatedAt.toISOString() !== new Date(updatedAt).toISOString()) {
    throw fail(409, 'ข้อมูลถูกแก้ไปแล้วจากที่อื่น — โหลดใหม่แล้วลองอีกครั้ง', 'conflict')
  }
}

/** Loads one order in scope, or 404. */
export async function findOrder(tem: EntityManager, scope: Scope, id: string): Promise<PurchaseOrder> {
  const order = await tem.findOne(PurchaseOrder, {
    id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (!order) throw fail(404, 'ไม่พบใบสั่งซื้อ', 'not_found')
  return order
}
