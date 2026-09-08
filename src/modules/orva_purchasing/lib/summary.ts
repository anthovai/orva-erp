import type { EntityManager } from '@mikro-orm/postgresql'
import type { Scope } from './orders'

/**
 * What purchasing owes the home screen.
 *
 * The two figures the owner needs without opening this module: money already
 * promised to vendors that has not been billed yet, and goods that were
 * promised to us and have not arrived. Both definitions live here rather than
 * in the home screen, because they are purchasing's rules — the home screen
 * only draws them.
 */
export type LateLine = {
  orderId: string
  poNumber: string | null
  lineId: string
  lineNo: number
  description: string
  vendorName: string
  unit: string | null
  orderedQty: number
  receivedQty: number
  remainingQty: number
  expectedOn: string
  daysLate: number
}

export type PurchasingSummary = {
  /**
   * Ex-VAT value of open orders not yet covered by a bill link, floored per
   * line: an over-billed line contributes nothing rather than a negative,
   * because this answers "how much is still coming as a bill", and a vendor
   * who charged extra has not reduced what the others will charge.
   */
  committedNotBilled: number
  lateLines: LateLine[]
  lateCount: number
}

/** Statuses that still owe something. Closed and cancelled owe nothing. */
const OPEN_STATUSES = "('sent','partially_received','received')"

export async function purchasingSummary(
  em: EntityManager,
  scope: Scope,
  today: string,
): Promise<PurchasingSummary> {
  const [committed] = (await em.execute(
    `select coalesce(sum(greatest(0, net.line_net - coalesce(billed.amount, 0))), 0)::text as committed
       from (
         select l.id, l.order_id, (l.quantity * l.unit_price) as line_net
           from orva_purchasing_order_lines l
           join orva_purchasing_orders o on o.id = l.order_id and o.deleted_at is null
          where l.deleted_at is null
            and l.tenant_id = ?::uuid
            and (?::uuid is null or l.organization_id = ?::uuid)
            and o.status in ${OPEN_STATUSES}
       ) net
       left join (
         select k.order_line_id, sum(k.amount) as amount
           from orva_purchasing_bill_links k
           join orva_ap_bills b on b.id = k.bill_id and b.deleted_at is null
          where k.deleted_at is null and k.tenant_id = ?::uuid
          group by k.order_line_id
       ) billed on billed.order_line_id = net.id`,
    [scope.tenantId, scope.organizationId, scope.organizationId, scope.tenantId],
  )) as Array<{ committed: string }>

  const rows = (await em.execute(
    `select o.id as order_id, o.po_number, coalesce(p.display_name, '—') as vendor_name,
            l.id as line_id, l.line_no, l.description, l.unit,
            l.quantity::text as ordered_qty,
            coalesce(r.received, 0)::text as received_qty,
            to_char(l.expected_on, 'YYYY-MM-DD') as expected_on,
            (?::date - l.expected_on)::int as days_late
       from orva_purchasing_order_lines l
       join orva_purchasing_orders o on o.id = l.order_id and o.deleted_at is null
       left join orva_parties p on p.id = o.vendor_party_id and p.deleted_at is null
       left join (
         select order_line_id, sum(quantity) as received
           from orva_purchasing_receipts
          where deleted_at is null and tenant_id = ?::uuid
          group by order_line_id
       ) r on r.order_line_id = l.id
      where l.deleted_at is null
        and l.tenant_id = ?::uuid
        and (?::uuid is null or l.organization_id = ?::uuid)
        and o.status in ('sent','partially_received')
        and l.expected_on is not null
        and l.expected_on < ?::date
        and l.quantity > coalesce(r.received, 0)
      order by l.expected_on, o.po_number
      limit 50`,
    [today, scope.tenantId, scope.tenantId, scope.organizationId, scope.organizationId, today],
  )) as Array<{
    order_id: string
    po_number: string | null
    vendor_name: string
    line_id: string
    line_no: number
    description: string
    unit: string | null
    ordered_qty: string
    received_qty: string
    expected_on: string
    days_late: number
  }>

  const lateLines = rows.map((row) => {
    const orderedQty = Number(row.ordered_qty)
    const receivedQty = Number(row.received_qty)
    return {
      orderId: row.order_id,
      poNumber: row.po_number,
      lineId: row.line_id,
      lineNo: row.line_no,
      description: row.description,
      vendorName: row.vendor_name,
      unit: row.unit,
      orderedQty,
      receivedQty,
      remainingQty: Math.max(0, orderedQty - receivedQty),
      expectedOn: row.expected_on,
      daysLate: Number(row.days_late),
    }
  })

  return {
    committedNotBilled: Number(committed?.committed ?? 0),
    lateLines,
    lateCount: lateLines.length,
  }
}
