"use client"
import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@/components/orva/Page'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { FileText, Link2, PackageCheck, Printer, Send, Wrench } from 'lucide-react'
import { PurchaseOrderForm } from './PurchaseOrderForm'
import { ReceiveDialog, type ReceiveLinePayload } from './ReceiveDialog'
import { LinkBillDialog, type BillAllocation } from './LinkBillDialog'

type DetailLine = {
  id: string
  lineNo: number
  kind: string
  catalogVariantId: string | null
  description: string
  sku: string | null
  quantity: number
  unit: string | null
  unitPrice: number
  vatMode: string
  accountId: string
  accountCode: string | null
  accountName: string | null
  expectedOn: string | null
  shortQty: number | null
  net: number
  vat: number
  receivedQty: number
  remainingQty: number
  billedAmount: number
  variance: number | null
  isLate: boolean
}

type Detail = {
  order: {
    id: string
    poNumber: string | null
    status: string
    vendorPartyId: string
    vendorName: string
    vendorEmail: string | null
    orderDate: string
    expectedOn: string | null
    currencyCode: string
    subtotal: number
    taxAmount: number
    totalAmount: number
    billedAmount: number
    memo: string | null
    vendorReference: string | null
    closeReason: string | null
    sentAt: string | null
    closedAt: string | null
    cancelledAt: string | null
    updatedAt: string
  }
  lines: DetailLine[]
  receipts: DetailReceipt[]
  /** WMS receipts for this order with no row here — the repair is offered. */
  unlinkedReceipts: number
}

type DetailReceipt = {
  id: string
  lineId: string
  lineNo: number
  description: string
  quantity: number
  receivedOn: string
  lotNumber: string | null
  movementId: string | null
  unitCost: number | null
  memo: string | null
}

const money = (value: number) => value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const qty = (value: number) => value.toLocaleString('th-TH', { maximumFractionDigits: 4 })

const STATUS_VARIANT: Record<string, StatusBadgeVariant> = {
  draft: 'neutral',
  sent: 'info',
  partially_received: 'warning',
  received: 'success',
  closed: 'neutral',
  cancelled: 'error',
}

/** A reason is the whole point of closing or cancelling, so it is required. */
function ReasonDialog({
  open,
  onOpenChange,
  title,
  hint,
  confirmLabel,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  hint: string
  confirmLabel: string
  onSubmit: (reason: string) => Promise<void>
}) {
  const t = useT()
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (open) setReason('')
  }, [open])

  const submit = async () => {
    if (!reason.trim()) return
    setBusy(true)
    try {
      await onSubmit(reason.trim())
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div
          className="flex flex-col gap-3"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              void submit()
            }
          }}
        >
          <p className="text-sm text-muted-foreground">{hint}</p>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t('orva_purchasing.field.reason', 'เหตุผล')}</span>
            <Input autoFocus value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              {t('orva_purchasing.cancel', 'ยกเลิก')}
            </Button>
            <Button onClick={submit} disabled={busy || !reason.trim()}>
              {busy ? t('orva_purchasing.saving', 'กำลังบันทึก…') : confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Raising a quantity on a sent order: the one edit the freeze allows. */
function AdjustDialog({
  line,
  onOpenChange,
  onSubmit,
}: {
  line: DetailLine | null
  onOpenChange: (open: boolean) => void
  onSubmit: (quantity: number, reason: string) => Promise<void>
}) {
  const t = useT()
  const [quantity, setQuantity] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (line) {
      setQuantity(String(line.quantity))
      setReason('')
    }
  }, [line])

  const submit = async () => {
    if (!line || !reason.trim() || !(Number(quantity) > line.quantity)) return
    setBusy(true)
    try {
      await onSubmit(Number(quantity), reason.trim())
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={line != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('orva_purchasing.adjust.title', 'เพิ่มจำนวนที่สั่ง')}</DialogTitle>
        </DialogHeader>
        <div
          className="flex flex-col gap-3"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              void submit()
            }
          }}
        >
          <p className="text-sm text-muted-foreground">
            {t(
              'orva_purchasing.adjust.hint',
              'ใช้เมื่อผู้ขายส่งของมามากกว่าที่สั่ง — เพิ่มได้เท่านั้น ถ้าของมาไม่ครบให้ปิดใบสั่งซื้อพร้อมเหตุผล',
            )}
          </p>
          {line ? (
            <p className="text-sm">
              {line.description} · {t('orva_purchasing.adjust.current', 'เดิม')} {qty(line.quantity)}
            </p>
          ) : null}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t('orva_purchasing.field.newQuantity', 'จำนวนใหม่')}</span>
            <Input type="number" min="0" step="0.0001" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">{t('orva_purchasing.field.reason', 'เหตุผล')}</span>
            <Input value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              {t('orva_purchasing.cancel', 'ยกเลิก')}
            </Button>
            <Button onClick={submit} disabled={busy || !reason.trim() || !line || !(Number(quantity) > line.quantity)}>
              {busy ? t('orva_purchasing.saving', 'กำลังบันทึก…') : t('orva_purchasing.adjust.confirm', 'เพิ่มจำนวน')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * One order.
 *
 * A draft is a form — nothing has been promised yet, so editing it is the
 * primary action. Anything sent is a record: it shows what was promised
 * against what has arrived and what has been billed, and offers only the
 * moves the lifecycle allows, each disabled with the reason it is unavailable
 * rather than hidden.
 */
export default function PurchaseOrderDetail({ orderId }: { orderId: string }) {
  const t = useT()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [closing, setClosing] = React.useState(false)
  const [cancelling, setCancelling] = React.useState(false)
  const [adjusting, setAdjusting] = React.useState<DetailLine | null>(null)
  const [receiving, setReceiving] = React.useState(false)
  const [linkingBill, setLinkingBill] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  const detail = useQuery({
    queryKey: ['orva_purchasing.order', orderId],
    queryFn: () => readApiResultOrThrow<Detail>(`/api/orva_purchasing/orders/${orderId}`),
  })

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['orva_purchasing.order', orderId] })
    await queryClient.invalidateQueries({ queryKey: ['orva_purchasing.orders'] })
    // Receiving moved stock, so the lot and valuation screens are stale too.
    await queryClient.invalidateQueries({ queryKey: ['orva_stock.lots'] })
    await queryClient.invalidateQueries({ queryKey: ['orva_stock.valuation'] })
  }

  const post = async (path: string, body: Record<string, unknown>, success: string) => {
    setBusy(true)
    try {
      const res = await apiCall<{ ok: true }>(`/api/orva_purchasing/orders/${orderId}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok || !res.result) throw new Error((res.result as { error?: string } | undefined)?.error ?? 'failed')
      flash(success, 'success')
      await refresh()
    } catch (error) {
      // 409s arrive here with the server's wording: stale version, frozen
      // order, or a settled one. Reloading the page is the recovery.
      flash(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (detail.isLoading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('orva_purchasing.loading', 'กำลังโหลด…')} />
        </PageBody>
      </Page>
    )
  }
  if (detail.isError || !detail.data) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={t('orva_purchasing.detail.error', 'เปิดใบสั่งซื้อไม่ได้')}
            description={detail.error instanceof Error ? detail.error.message : undefined}
          />
        </PageBody>
      </Page>
    )
  }

  const { order, lines, receipts, unlinkedReceipts } = detail.data
  const isDraft = order.status === 'draft'
  const isSettled = order.status === 'closed' || order.status === 'cancelled'
  const canCancel = order.status === 'draft' || order.status === 'sent'
  const heading = order.poNumber ?? t('orva_purchasing.status.draft', 'ฉบับร่าง')
  const outstanding = lines.filter((line) => line.remainingQty > 0)

  const send = async () => {
    const confirmed = await confirm({
      title: t('orva_purchasing.confirmSend', 'ส่งใบสั่งซื้อนี้ให้ผู้ขาย? เลขที่จะถูกจองและรายการจะถูกล็อก'),
    })
    if (!confirmed) return
    await post('/send', { updatedAt: order.updatedAt }, t('orva_purchasing.sent', 'จองเลขที่และล็อกรายการแล้ว'))
  }

  const receive = async (receivedOn: string, payload: ReceiveLinePayload[]) => {
    await post(
      '/receive',
      { updatedAt: order.updatedAt, receivedOn, lines: payload },
      t('orva_purchasing.received', 'บันทึกการรับของแล้ว'),
    )
  }

  /** Writes down WMS receipts this order is missing. Idempotent, so a second
   *  press is harmless — which is why it needs no confirmation. */
  const repair = async () => {
    await post('/reconcile', {}, t('orva_purchasing.repaired', 'ผูกการรับของที่ค้างแล้ว'))
  }

  const linkBill = async (billId: string, allocations: BillAllocation[]) => {
    await post(
      '/bill',
      { updatedAt: order.updatedAt, billId, allocations },
      t('orva_purchasing.billLinked', 'ผูกบิลกับใบสั่งซื้อแล้ว'),
    )
  }

  const remove = async () => {
    const confirmed = await confirm({ title: t('orva_purchasing.confirmDelete', 'ลบฉบับร่างนี้?') })
    if (!confirmed) return
    setBusy(true)
    try {
      const res = await apiCall(`/api/orva_purchasing/orders?id=${order.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((res.result as { error?: string } | undefined)?.error ?? 'failed')
      flash(t('orva_purchasing.deleted', 'ลบฉบับร่างแล้ว'), 'success')
      router.push('/backend/purchasing/orders')
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page>
      <PageHeader
        title={`${t('orva_purchasing.detail.title', 'ใบสั่งซื้อ')} ${heading}`}
        description={`${order.vendorName} · ${t('orva_purchasing.column.orderDate', 'วันที่สั่ง')} ${order.orderDate}${
          order.expectedOn ? ` · ${t('orva_purchasing.column.expectedOn', 'คาดว่าได้รับ')} ${order.expectedOn}` : ''
        }`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge variant={STATUS_VARIANT[order.status] ?? 'neutral'}>
              {t(`orva_purchasing.status.${order.status}`, order.status)}
            </StatusBadge>
            <Button asChild variant="outline" size="sm">
              <Link href={`/backend/documents/preview?type=purchase_order&documentId=${order.id}`}>
                <Printer className="size-4" />
                {t('orva_purchasing.actions.print', 'พิมพ์ / ส่งอีเมล')}
              </Link>
            </Button>
            {isDraft ? (
              <>
                <Button size="sm" onClick={send} disabled={busy || lines.length === 0}>
                  <Send className="size-4" />
                  {t('orva_purchasing.actions.send', 'ส่งให้ผู้ขาย')}
                </Button>
                <Button variant="ghost" size="sm" onClick={remove} disabled={busy}>
                  {t('orva_purchasing.actions.delete', 'ลบฉบับร่าง')}
                </Button>
              </>
            ) : null}
            {!isDraft && !isSettled ? (
              <>
                <Button size="sm" onClick={() => setReceiving(true)} disabled={busy || outstanding.length === 0}>
                  <PackageCheck className="size-4" />
                  {t('orva_purchasing.actions.receive', 'รับของ')}
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/backend/ap/bills/create?poId=${order.id}`}>
                    <FileText className="size-4" />
                    {t('orva_purchasing.actions.bill', 'ออกบิลจากใบสั่งซื้อ')}
                  </Link>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setLinkingBill(true)} disabled={busy}>
                  <Link2 className="size-4" />
                  {t('orva_purchasing.actions.linkBill', 'ผูกบิลที่มีอยู่')}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setClosing(true)} disabled={busy}>
                  {t('orva_purchasing.actions.close', 'ปิดใบสั่งซื้อ')}
                </Button>
              </>
            ) : null}
            {canCancel ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCancelling(true)}
                disabled={busy}
                title={t('orva_purchasing.actions.cancelHint', 'ยกเลิกได้เฉพาะใบที่ยังไม่มีของและยังไม่มีบิล')}
              >
                {t('orva_purchasing.actions.cancel', 'ยกเลิกใบสั่งซื้อ')}
              </Button>
            ) : null}
          </div>
        }
      />
      <PageBody>
        {isDraft ? (
          <PurchaseOrderForm
            initial={{
              id: order.id,
              updatedAt: order.updatedAt,
              vendorPartyId: order.vendorPartyId,
              orderDate: order.orderDate,
              expectedOn: order.expectedOn,
              memo: order.memo,
              vendorReference: order.vendorReference,
              lines: lines.map((line) => ({
                id: line.id,
                kind: line.kind,
                catalogVariantId: line.catalogVariantId,
                description: line.description,
                sku: line.sku,
                quantity: line.quantity,
                unit: line.unit,
                unitPrice: line.unitPrice,
                vatMode: line.vatMode,
                accountId: line.accountId,
                expectedOn: line.expectedOn,
              })),
            }}
          />
        ) : (
          <div className="flex flex-col gap-6">
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-max text-sm">
                <caption className="sr-only">{t('orva_purchasing.lines.title', 'รายการที่สั่ง')}</caption>
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">{t('orva_purchasing.lines.item', 'รายการ')}</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">{t('orva_purchasing.lines.ordered', 'สั่ง')}</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">{t('orva_purchasing.lines.received', 'รับแล้ว')}</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">{t('orva_purchasing.field.unitPrice', 'ราคา/หน่วย')}</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">{t('orva_purchasing.lines.net', 'มูลค่า')}</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">{t('orva_purchasing.lines.billed', 'บิลแล้ว')}</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">{t('orva_purchasing.lines.variance', 'ผลต่าง')}</th>
                    <th scope="col" className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.id} className="border-t">
                      <td className="px-3 py-2">
                        <span className="font-medium">{line.description}</span>
                        {line.kind === 'service' ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {t('orva_purchasing.field.service', 'บริการ')}
                          </span>
                        ) : null}
                        {line.accountCode ? (
                          <span className="block text-xs text-muted-foreground">
                            {line.accountCode} · {line.accountName}
                          </span>
                        ) : null}
                        {line.expectedOn ? (
                          <span className={`block text-xs ${line.isLate ? 'text-status-warning-fg' : 'text-muted-foreground'}`}>
                            {t('orva_purchasing.column.expectedOn', 'คาดว่าได้รับ')} {line.expectedOn}
                            {line.isLate ? ` · ${t('orva_purchasing.lines.late', 'เกินกำหนด')}` : ''}
                          </span>
                        ) : null}
                        {line.shortQty != null && line.shortQty > 0 ? (
                          <span className="block text-xs text-muted-foreground">
                            {t('orva_purchasing.lines.short', 'ปิดโดยขาด {n}').replace('{n}', qty(line.shortQty))}
                            {line.unit ? ` ${line.unit}` : ''}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {qty(line.quantity)}
                        {line.unit ? <span className="ml-1 text-xs text-muted-foreground">{line.unit}</span> : null}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {qty(line.receivedQty)}
                        {line.remainingQty > 0 ? (
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({t('orva_purchasing.lines.remaining', 'เหลือ')} {qty(line.remainingQty)})
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(line.unitPrice)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(line.net)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {line.billedAmount > 0 ? money(line.billedAmount) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {line.variance == null ? (
                          '—'
                        ) : (
                          <span className={line.variance !== 0 ? 'text-status-warning-fg' : undefined}>
                            {line.variance > 0 ? '+' : ''}
                            {money(line.variance)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {!isSettled ? (
                          <Button variant="ghost" size="sm" onClick={() => setAdjusting(line)} disabled={busy}>
                            {t('orva_purchasing.actions.adjust', 'เพิ่มจำนวน')}
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {unlinkedReceipts > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-status-warning-border bg-status-warning-bg px-4 py-3 text-sm">
                <span>
                  {t(
                    'orva_purchasing.repair.notice',
                    'มีการรับของในคลัง {n} รายการที่ยังไม่ผูกกับใบสั่งซื้อนี้ — ของอยู่ในคลังแล้วแต่ใบนี้ยังนับไม่ครบ',
                  ).replace('{n}', String(unlinkedReceipts))}
                </span>
                <Button size="sm" variant="outline" onClick={repair} disabled={busy}>
                  <Wrench className="size-4" />
                  {t('orva_purchasing.actions.repair', 'ซ่อมการรับของ')}
                </Button>
              </div>
            ) : null}

            {receipts.length > 0 ? (
              <section className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold">{t('orva_purchasing.receipts.title', 'ประวัติการรับของ')}</h2>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full min-w-max text-sm">
                    <caption className="sr-only">{t('orva_purchasing.receipts.title', 'ประวัติการรับของ')}</caption>
                    <thead className="bg-muted/50 text-left">
                      <tr>
                        <th scope="col" className="px-3 py-2 font-medium">{t('orva_purchasing.receive.receivedOn', 'วันที่รับของ')}</th>
                        <th scope="col" className="px-3 py-2 font-medium">{t('orva_purchasing.lines.item', 'รายการ')}</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">{t('orva_purchasing.receive.quantity', 'รับจำนวน')}</th>
                        <th scope="col" className="px-3 py-2 font-medium">{t('orva_purchasing.receive.lotNumber', 'เลขล็อต')}</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">{t('orva_purchasing.receive.unitCost', 'ต้นทุน/หน่วย')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {receipts.map((receipt) => (
                        <tr key={receipt.id} className="border-t">
                          <td className="px-3 py-2">{receipt.receivedOn}</td>
                          <td className="px-3 py-2">{receipt.description}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{qty(receipt.quantity)}</td>
                          <td className="px-3 py-2">{receipt.lotNumber ?? '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {receipt.unitCost == null ? '—' : money(receipt.unitCost)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            <div className="flex flex-wrap justify-between gap-6 rounded-md border p-4 text-sm">
              <dl className="grid gap-1">
                <div className="flex gap-3">
                  <dt className="text-muted-foreground">{t('orva_purchasing.totals.subtotal', 'รวมก่อน VAT')}</dt>
                  <dd className="tabular-nums">{money(order.subtotal)}</dd>
                </div>
                <div className="flex gap-3">
                  <dt className="text-muted-foreground">{t('orva_purchasing.totals.vat', 'VAT')}</dt>
                  <dd className="tabular-nums">{money(order.taxAmount)}</dd>
                </div>
                <div className="flex gap-3 font-semibold">
                  <dt>{t('orva_purchasing.totals.total', 'รวมทั้งสิ้น')}</dt>
                  <dd className="tabular-nums">{money(order.totalAmount)}</dd>
                </div>
                <div className="flex gap-3">
                  <dt className="text-muted-foreground">{t('orva_purchasing.totals.billed', 'บิลแล้ว')}</dt>
                  <dd className="tabular-nums">{money(order.billedAmount)}</dd>
                </div>
              </dl>
              <dl className="grid gap-1 text-xs text-muted-foreground">
                {order.vendorReference ? (
                  <div className="flex gap-2">
                    <dt>{t('orva_purchasing.field.vendorReference', 'อ้างอิงของผู้ขาย')}</dt>
                    <dd>{order.vendorReference}</dd>
                  </div>
                ) : null}
                {order.sentAt ? (
                  <div className="flex gap-2">
                    <dt>{t('orva_purchasing.detail.sentAt', 'ส่งให้ผู้ขายเมื่อ')}</dt>
                    <dd>{order.sentAt.slice(0, 16).replace('T', ' ')}</dd>
                  </div>
                ) : null}
                {order.closedAt ? (
                  <div className="flex gap-2">
                    <dt>{t('orva_purchasing.detail.closedAt', 'ปิดเมื่อ')}</dt>
                    <dd>{order.closedAt.slice(0, 10)}</dd>
                  </div>
                ) : null}
                {order.cancelledAt ? (
                  <div className="flex gap-2">
                    <dt>{t('orva_purchasing.detail.cancelledAt', 'ยกเลิกเมื่อ')}</dt>
                    <dd>{order.cancelledAt.slice(0, 10)}</dd>
                  </div>
                ) : null}
                {order.closeReason ? (
                  <div className="flex gap-2">
                    <dt>{t('orva_purchasing.field.reason', 'เหตุผล')}</dt>
                    <dd>{order.closeReason}</dd>
                  </div>
                ) : null}
              </dl>
            </div>

            {order.memo ? (
              <p className="whitespace-pre-line rounded-md border bg-muted/30 px-4 py-3 text-sm">{order.memo}</p>
            ) : null}
          </div>
        )}
      </PageBody>

      <ReasonDialog
        open={closing}
        onOpenChange={setClosing}
        title={t('orva_purchasing.close.title', 'ปิดใบสั่งซื้อ')}
        hint={t(
          'orva_purchasing.close.hint',
          'ปิดแล้วจะบันทึกจำนวนที่ยังไม่ได้รับไว้เป็นส่วนที่ขาด และใบนี้จะไม่ถูกตามต่อ',
        )}
        confirmLabel={t('orva_purchasing.close.confirm', 'ปิดใบสั่งซื้อ')}
        onSubmit={(reason) =>
          post('/close', { updatedAt: order.updatedAt, reason }, t('orva_purchasing.closed', 'ปิดใบสั่งซื้อแล้ว'))
        }
      />
      <ReasonDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={t('orva_purchasing.cancelOrder.title', 'ยกเลิกใบสั่งซื้อ')}
        hint={t('orva_purchasing.cancelOrder.hint', 'ใช้เมื่อการสั่งซื้อนี้ไม่เกิดขึ้นเลย')}
        confirmLabel={t('orva_purchasing.cancelOrder.confirm', 'ยกเลิกใบสั่งซื้อ')}
        onSubmit={(reason) =>
          post('/cancel', { updatedAt: order.updatedAt, reason }, t('orva_purchasing.cancelled', 'ยกเลิกใบสั่งซื้อแล้ว'))
        }
      />
      <ReceiveDialog
        open={receiving}
        onOpenChange={setReceiving}
        poNumber={heading}
        lines={lines.map((line) => ({
          id: line.id,
          lineNo: line.lineNo,
          kind: line.kind,
          description: line.description,
          unit: line.unit,
          unitPrice: line.unitPrice,
          quantity: line.quantity,
          receivedQty: line.receivedQty,
          remainingQty: line.remainingQty,
        }))}
        onSubmit={receive}
      />
      <LinkBillDialog
        orderId={order.id}
        open={linkingBill}
        onOpenChange={setLinkingBill}
        lines={lines.map((line) => ({
          id: line.id,
          lineNo: line.lineNo,
          description: line.description,
          accountId: line.accountId,
          net: line.net,
          billedAmount: line.billedAmount,
        }))}
        onSubmit={linkBill}
      />
      <AdjustDialog
        line={adjusting}
        onOpenChange={(open) => {
          if (!open) setAdjusting(null)
        }}
        onSubmit={(quantity, reason) =>
          post(
            `/lines/${adjusting?.id}/adjust-quantity`,
            { updatedAt: order.updatedAt, quantity, reason },
            t('orva_purchasing.adjusted', 'เพิ่มจำนวนแล้ว'),
          )
        }
      />
      {ConfirmDialogElement}
    </Page>
  )
}
