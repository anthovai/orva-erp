import type { EntityManager } from '@mikro-orm/postgresql'
import { PurchaseBillLink } from '../data/entities'
import type { BillAllocationInput } from '../data/validators'
import { fail, type Scope } from './orders'
import { round2 } from './totals'

/** Ex-VAT amount billed per ordered line, keyed by line id. */
export async function billedByLine(
  tem: EntityManager,
  scope: Scope,
  orderId: string,
): Promise<Map<string, number>> {
  const rows = (await tem.execute(
    `select l.order_line_id, sum(l.amount)::text as billed
       from orva_purchasing_bill_links l
       join orva_ap_bills b on b.id = l.bill_id and b.deleted_at is null
      where l.order_id = ?::uuid and l.tenant_id = ?::uuid and l.deleted_at is null
      group by l.order_line_id`,
    [orderId, scope.tenantId],
  )) as Array<{ order_line_id: string; billed: string }>
  return new Map(rows.map((row) => [row.order_line_id, Number(row.billed)]))
}

export type BillLineRow = {
  id: string
  billId: string
  billNo: string | null
  lineNo: number
  amount: number
  description: string | null
  accountId: string
  accountCode: string | null
  linkedOrderId: string | null
}

/**
 * Lines of one bill with whether each is already spoken for.
 *
 * The join to `orva_ap_bills` is what scopes this: a bill of another vendor,
 * or a deleted one, is not offered for linking at all.
 */
export async function billLines(
  tem: EntityManager,
  scope: Scope,
  billId: string,
): Promise<BillLineRow[]> {
  const rows = (await tem.execute(
    `select bl.id, bl.bill_id, b.bill_no, bl.line_no, bl.amount::text as amount, bl.description,
            bl.expense_account_id, a.code as account_code,
            (select k.order_id::text from orva_purchasing_bill_links k
              where k.bill_line_id = bl.id and k.deleted_at is null limit 1) as linked_order_id
       from orva_ap_bill_lines bl
       join orva_ap_bills b on b.id = bl.bill_id and b.deleted_at is null
       left join orva_gl_accounts a on a.id = bl.expense_account_id and a.tenant_id = bl.tenant_id
      where bl.bill_id = ?::uuid and bl.tenant_id = ?::uuid and bl.deleted_at is null
        and (?::uuid is null or b.organization_id = ?::uuid)
      order by bl.line_no`,
    [billId, scope.tenantId, scope.organizationId, scope.organizationId],
  )) as Array<{
    id: string
    bill_id: string
    bill_no: string | null
    line_no: number
    amount: string
    description: string | null
    expense_account_id: string
    account_code: string | null
    linked_order_id: string | null
  }>
  return rows.map((row) => ({
    id: row.id,
    billId: row.bill_id,
    billNo: row.bill_no,
    lineNo: row.line_no,
    amount: Number(row.amount),
    description: row.description,
    accountId: row.expense_account_id,
    accountCode: row.account_code,
    linkedOrderId: row.linked_order_id,
  }))
}

export type UnlinkedBill = {
  id: string
  billNo: string | null
  billDate: string
  status: string
  totalAmount: number
  vendorBillRef: string | null
  unlinkedLines: number
}

/**
 * This vendor's bills that still have a line nobody has allocated.
 *
 * The recovery path for the one gap the two-step design leaves: finance
 * created the bill, the link call never landed, and the order is
 * under-reporting what it has been charged. Only this order's vendor, because
 * a bill from somebody else can never belong to it.
 */
export async function findUnlinkedBills(
  tem: EntityManager,
  scope: Scope,
  vendorPartyId: string,
): Promise<UnlinkedBill[]> {
  const rows = (await tem.execute(
    `select b.id, b.bill_no, to_char(b.bill_date, 'YYYY-MM-DD') as bill_date, b.status,
            b.total_amount::text as total_amount, b.vendor_bill_ref,
            count(bl.id) filter (
              where not exists (
                select 1 from orva_purchasing_bill_links k
                 where k.bill_line_id = bl.id and k.deleted_at is null
              )
            )::int as unlinked_lines
       from orva_ap_bills b
       join orva_ap_bill_lines bl on bl.bill_id = b.id and bl.deleted_at is null
      where b.tenant_id = ?::uuid and b.deleted_at is null
        and (?::uuid is null or b.organization_id = ?::uuid)
        and b.vendor_party_id = ?::uuid
      group by b.id, b.bill_no, b.bill_date, b.status, b.total_amount, b.vendor_bill_ref
     having count(bl.id) filter (
              where not exists (
                select 1 from orva_purchasing_bill_links k
                 where k.bill_line_id = bl.id and k.deleted_at is null
              )
            ) > 0
      order by b.bill_date desc, b.created_at desc
      limit 50`,
    [scope.tenantId, scope.organizationId, scope.organizationId, vendorPartyId],
  )) as Array<{
    id: string
    bill_no: string | null
    bill_date: string
    status: string
    total_amount: string
    vendor_bill_ref: string | null
    unlinked_lines: number
  }>
  return rows.map((row) => ({
    id: row.id,
    billNo: row.bill_no,
    billDate: row.bill_date,
    status: row.status,
    totalAmount: Number(row.total_amount),
    vendorBillRef: row.vendor_bill_ref,
    unlinkedLines: Number(row.unlinked_lines),
  }))
}

export type LinkPlanItem = {
  allocation: BillAllocationInput
  billLine: BillLineRow
  /** True when this exact allocation already exists, so the write skips it. */
  alreadyLinked: boolean
}

/**
 * Decides what a link call may write.
 *
 * Idempotent by design: an allocation identical to one that already exists is
 * a no-op rather than an error, because the client that lost a response has to
 * be able to retry. An allocation that contradicts an existing one — same bill
 * line, different order line or amount — is refused, since a charge cannot
 * answer two commitments.
 */
export function planBillLinks(args: {
  orderId: string
  orderLineIds: Set<string>
  billLines: BillLineRow[]
  existing: Array<{ billLineId: string; orderLineId: string; amount: number }>
  allocations: BillAllocationInput[]
}): LinkPlanItem[] {
  const byLineNo = new Map(args.billLines.map((line) => [line.lineNo, line]))
  const existingByBillLine = new Map(args.existing.map((row) => [row.billLineId, row]))
  const seen = new Set<number>()
  const plan: LinkPlanItem[] = []

  for (const allocation of args.allocations) {
    if (!args.orderLineIds.has(allocation.lineId)) {
      throw fail(404, 'ไม่พบบรรทัดนี้ในใบสั่งซื้อ', 'line_not_found')
    }
    const billLine = byLineNo.get(allocation.billLineNo)
    if (!billLine) {
      throw fail(404, `บิลนี้ไม่มีบรรทัดที่ ${allocation.billLineNo}`, 'bill_line_not_found')
    }
    if (seen.has(allocation.billLineNo)) {
      throw fail(400, `บรรทัดบิลที่ ${allocation.billLineNo} ถูกผูกซ้ำในคำขอเดียว`, 'duplicate_allocation')
    }
    seen.add(allocation.billLineNo)

    if (round2(allocation.amount) > round2(billLine.amount)) {
      throw fail(
        400,
        `ยอดที่ผูก (${allocation.amount.toLocaleString('th-TH')}) มากกว่ายอดบรรทัดบิลที่ ${allocation.billLineNo} (${billLine.amount.toLocaleString('th-TH')})`,
        'amount_exceeds_bill_line',
      )
    }

    const existing = existingByBillLine.get(billLine.id)
    if (existing) {
      const same =
        existing.orderLineId === allocation.lineId && round2(existing.amount) === round2(allocation.amount)
      if (same) {
        plan.push({ allocation, billLine, alreadyLinked: true })
        continue
      }
      throw fail(
        409,
        `บรรทัดบิลที่ ${allocation.billLineNo} ถูกผูกกับรายการอื่นไว้แล้ว — ยกเลิกการผูกเดิมก่อน`,
        'already_linked',
      )
    }
    if (billLine.linkedOrderId && billLine.linkedOrderId !== args.orderId) {
      throw fail(
        409,
        `บรรทัดบิลที่ ${allocation.billLineNo} ถูกผูกกับใบสั่งซื้ออื่นไว้แล้ว`,
        'already_linked',
      )
    }
    plan.push({ allocation, billLine, alreadyLinked: false })
  }
  return plan
}

/** Writes the plan. Returns how many links were actually new. */
export function persistBillLinks(
  tem: EntityManager,
  scope: Scope,
  orderId: string,
  plan: LinkPlanItem[],
  userId: string | null,
): number {
  const now = new Date()
  let written = 0
  for (const item of plan) {
    if (item.alreadyLinked) continue
    tem.persist(
      tem.create(PurchaseBillLink, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        orderId,
        orderLineId: item.allocation.lineId,
        billId: item.billLine.billId,
        billLineId: item.billLine.id,
        billLineNo: item.billLine.lineNo,
        amount: round2(item.allocation.amount).toFixed(4),
        createdBy: userId,
        createdAt: now,
      }),
    )
    written += 1
  }
  return written
}
