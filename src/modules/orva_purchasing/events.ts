import { createModuleEvents } from '@open-mercato/shared/modules/events'

/**
 * What a purchase order announces.
 *
 * No consumer exists yet — these are emitted so the audit trail and any later
 * seam (a vendor scorecard, a cash-forecast subscriber) has something to hear
 * without purchasing having to grow a caller for it. `line_adjusted` is here
 * because raising an ordered quantity on a sent order is the one edit that
 * changes a commitment after the vendor was told what it was: it deserves its
 * own record, not a generic `updated`.
 *
 * `strict` is on: a typo in an id should fail the write that tried to emit it
 * rather than quietly emit nothing.
 */
const events = [
  { id: 'orva_purchasing.order.created', label: 'Purchase Order Created', entity: 'order', category: 'crud' },
  { id: 'orva_purchasing.order.updated', label: 'Purchase Order Updated', entity: 'order', category: 'crud' },
  { id: 'orva_purchasing.order.deleted', label: 'Purchase Order Deleted', entity: 'order', category: 'crud' },
  { id: 'orva_purchasing.order.sent', label: 'Purchase Order Sent To Vendor', entity: 'order', category: 'lifecycle' },
  { id: 'orva_purchasing.order.cancelled', label: 'Purchase Order Cancelled', entity: 'order', category: 'lifecycle' },
  { id: 'orva_purchasing.order.closed', label: 'Purchase Order Closed', entity: 'order', category: 'lifecycle' },
  { id: 'orva_purchasing.order.received', label: 'Purchase Order Goods Received', entity: 'order', category: 'lifecycle' },
  { id: 'orva_purchasing.order.billed', label: 'Purchase Order Bill Linked', entity: 'order', category: 'lifecycle' },
  { id: 'orva_purchasing.order.repaired', label: 'Purchase Order Receipts Repaired', entity: 'order', category: 'lifecycle' },
  { id: 'orva_purchasing.order.line_adjusted', label: 'Purchase Order Line Quantity Raised', entity: 'order', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'orva_purchasing',
  events,
  strict: true,
})

/** The typed emitter. Only the ids above compile. */
export const emitPurchasingEvent = eventsConfig.emit

export type PurchasingEventId = (typeof events)[number]['id']

/**
 * What every order event carries: scalars only, and enough that a subscriber
 * never has to read the purchasing tables back and race the next write.
 */
export type PurchaseOrderEvent = {
  id: string
  tenantId: string
  organizationId: string
  poNumber: string | null
  status: string
  vendorPartyId: string
  totalAmount: string
  updatedAt: string
}

export default eventsConfig
