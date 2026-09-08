import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { parseDecryptedFieldValue } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
// Type-only import: erased at build time, so this creates no runtime edge to
// orva_documents. It is deliberate — it is what makes the compiler catch the
// day the printed-sheet contract changes, instead of a sheet quietly losing a
// field.
import type { PurchaseOrderDocument } from '@/modules/orva_documents/lib/purchasingBridge'
import { PurchaseOrder } from '../data/entities'
import type { Scope } from './orders'
import { computeTotals, lineNet, type VatMode } from './totals'

type LineRow = {
  description: string
  sku: string | null
  quantity: string
  unit: string | null
  unit_price: string
  vat_mode: string
}

const asVat = (mode: string): VatMode => (mode === 'none' ? 'none' : '7')

/**
 * A decrypted json column arrives as the ENCODED STRING of the original
 * value, not the object — the same trap that once printed every real customer
 * as "ลูกค้าทั่วไป" on sales sheets (see orva_documents/lib/source.ts).
 */
function snapshotOf(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return null
  const parsed = parseDecryptedFieldValue(value)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null)

/**
 * Reads one purchase order as a printable document.
 *
 * `em` must be a PLAIN fork, not the transactional one from `withTenantRls`:
 * the encryption subscriber does not decrypt inside that transaction, and a
 * sheet printing ciphertext is worse than app-level scoping — which is why
 * every filter below states the tenant and organization explicitly. This is
 * the same trade the sales document readers make, for the same reason.
 *
 * The vendor block comes from the snapshot frozen at send time so a later
 * rename cannot rewrite a sheet already in the vendor's inbox; a draft has no
 * snapshot yet, so it falls back to the live party.
 */
export async function findOrderDocument(
  em: EntityManager,
  scope: Scope,
  orderId: string,
): Promise<PurchaseOrderDocument | null> {
  const [order] = await findWithDecryption(
    em,
    PurchaseOrder,
    { id: orderId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    {},
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  if (!order) return null

  const lineRows = (await em.execute(
    `select l.description, l.sku, l.quantity::text as quantity, l.unit,
            l.unit_price::text as unit_price, l.vat_mode
       from orva_purchasing_order_lines l
      where l.order_id = ?::uuid and l.tenant_id = ?::uuid and l.deleted_at is null
      order by l.line_no`,
    [orderId, scope.tenantId],
  )) as LineRow[]

  const measured = lineRows.map((row) => ({
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
    vatMode: asVat(row.vat_mode),
  }))
  const totals = computeTotals(measured)

  const snapshot = snapshotOf((order as { vendorSnapshot?: unknown }).vendorSnapshot)
  let vendorName = text(snapshot?.name)
  let vendorLegal = text(snapshot?.legalName)
  let vendorTaxId = text(snapshot?.taxId)
  let vendorPhone = text(snapshot?.phone)
  let vendorEmail = text(snapshot?.email)
  if (!vendorName) {
    const [live] = (await em.execute(
      `select display_name, legal_name, tax_id, phone, email
         from orva_parties
        where id = ?::uuid and tenant_id = ?::uuid and organization_id = ?::uuid and deleted_at is null`,
      [order.vendorPartyId, scope.tenantId, scope.organizationId],
    )) as Array<{ display_name: string; legal_name: string | null; tax_id: string | null; phone: string | null; email: string | null }>
    vendorName = live?.display_name ?? 'ผู้ขาย'
    vendorLegal = live?.legal_name ?? null
    vendorTaxId = live?.tax_id ?? null
    vendorPhone = live?.phone ?? null
    vendorEmail = live?.email ?? null
  }

  return {
    status: order.status,
    counterparty: {
      name: vendorName,
      legalName: vendorLegal,
      taxId: vendorTaxId,
      branch: null,
      address: null,
      phone: vendorPhone,
      email: vendorEmail,
    },
    source: {
      // A draft prints too — the owner checks the sheet before sending it —
      // and says so where the number would be.
      number: order.poNumber ?? 'ฉบับร่าง',
      issueDate: order.orderDate,
      secondaryDate: order.expectedOn ?? null,
      currencyCode: order.currencyCode,
      lines: lineRows.map((row, index) => ({
        description: [row.description, row.sku ? `(${row.sku})` : null, row.unit ? `· ${row.unit}` : null]
          .filter(Boolean)
          .join(' '),
        quantity: measured[index].quantity,
        unitPrice: measured[index].unitPrice,
        amount: lineNet(measured[index]),
      })),
      subtotal: totals.subtotal,
      taxRate: totals.taxRate,
      taxAmount: totals.taxAmount,
      grandTotal: totals.total,
      note: order.memo ?? null,
    },
  }
}
