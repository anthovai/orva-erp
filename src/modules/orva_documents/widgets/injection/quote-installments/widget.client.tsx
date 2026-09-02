"use client"
import * as React from 'react'
import Link from 'next/link'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { RecordPaymentDialog } from '../../../components/RecordPaymentDialog'

type Installment = {
  id: string
  invoiceNumber: string
  installmentNo: number | null
  installmentPercent: number | null
  issueDate: string | null
  dueDate: string | null
  paidDate: string | null
  grandTotal: number
  outstanding: number
}

const thb = (value: number) => value.toLocaleString('th-TH', { minimumFractionDigits: 2 })

/**
 * The งวด already issued from this quote, shown ON the quote — the missing
 * half of the one-bill-two-record-types split: after billing documents
 * stopped printing from the quote, there was no way to SEE the invoices this
 * quote had produced without walking to the invoice list. The user's exact
 * words: "ไม่เจอ".
 */
export default function QuoteInstallmentsWidget({ data }: { data?: Record<string, unknown> }) {
  const t = useT()
  const quoteId = typeof data?.id === 'string' ? data.id : null
  const [items, setItems] = React.useState<Installment[] | null>(null)
  const [paymentInvoiceId, setPaymentInvoiceId] = React.useState<string | null>(null)
  const [reloadKey, setReloadKey] = React.useState(0)
  // first slip attachment per paid invoice — the transfer proof, one click away
  const [slips, setSlips] = React.useState<Record<string, string>>({})

  React.useEffect(() => {
    if (!quoteId) return
    let cancelled = false
    apiCall<{ items: Installment[] }>(`/api/orva_documents/issue-invoice?quoteId=${quoteId}`)
      .then(async (call) => {
        if (cancelled || !call.ok || !call.result) return
        setItems(call.result.items)
        const paid = call.result.items.filter((item) => item.paidDate)
        const entries = await Promise.all(paid.map(async (item) => {
          const res = await apiCall<{ items?: Array<{ id: string }> }>(
            `/api/attachments?entityId=sales:sales_invoice&recordId=${item.id}&pageSize=1`,
          ).catch(() => null)
          const attachmentId = res?.ok ? res.result?.items?.[0]?.id : undefined
          return attachmentId ? ([item.id, attachmentId] as const) : null
        }))
        if (!cancelled) setSlips(Object.fromEntries(entries.filter((entry): entry is [string, string] => !!entry)))
      })
      .catch(() => { if (!cancelled) setItems([]) })
    return () => { cancelled = true }
  }, [quoteId, reloadKey])

  if (!quoteId) return null

  return (
    <div className="space-y-2 rounded-md border p-4">
      <p className="text-sm font-semibold">
        {t('orva_documents.installments.title', 'ใบแจ้งหนี้ที่ออกจากใบนี้')}
      </p>
      {items === null ? null : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t(
            'orva_documents.installments.empty',
            'ยังไม่ได้ออกงวด — ใช้ปุ่ม "ออกใบแจ้งหนี้งวด" ด้านบนเมื่อพร้อมเรียกเก็บ',
          )}
        </p>
      ) : (
        <ul className="divide-y">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm">
              <span className="font-medium">{item.invoiceNumber}</span>
              <span className="text-muted-foreground">
                {item.installmentNo != null
                  ? t('orva_documents.installments.no', 'งวดที่ {n}', { n: String(item.installmentNo) })
                  : null}
                {item.installmentPercent != null ? ` (${item.installmentPercent}%)` : ''}
              </span>
              <span className="tabular-nums">{thb(item.grandTotal)}</span>
              <span className={item.paidDate ? 'text-primary' : 'text-muted-foreground'}>
                {item.paidDate
                  ? t('orva_documents.installments.paid', 'รับชำระแล้ว {date}', { date: item.paidDate })
                  : item.dueDate
                    ? t('orva_documents.installments.due', 'ครบกำหนด {date}', { date: item.dueDate })
                    : ''}
              </span>
              <span className="ml-auto flex gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href={`/backend/documents/preview?type=invoice&documentId=${item.id}`}>
                    {t('orva_documents.type.invoice', 'ใบแจ้งหนี้')}
                  </Link>
                </Button>
                {!item.paidDate ? (
                  <Button variant="outline" size="sm" onClick={() => setPaymentInvoiceId(item.id)}>
                    {t('orva_documents.payment.title', 'บันทึกรับชำระ')}
                  </Button>
                ) : null}
                {slips[item.id] ? (
                  <Button asChild variant="ghost" size="sm">
                    <a href={`/api/attachments/file/${slips[item.id]}`} target="_blank" rel="noreferrer">
                      {t('orva_documents.payment.viewSlip', 'ดูสลิป')}
                    </a>
                  </Button>
                ) : null}
                <Button asChild variant="outline" size="sm">
                  <Link href={`/backend/documents/preview?type=receipt&documentId=${item.id}`}>
                    {t('orva_documents.rowAction.receipt', 'ออกใบกำกับภาษี/ใบเสร็จ')}
                  </Link>
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <RecordPaymentDialog
        invoiceId={paymentInvoiceId}
        open={paymentInvoiceId !== null}
        onOpenChange={(next) => { if (!next) setPaymentInvoiceId(null) }}
        onRecorded={() => setReloadKey((k) => k + 1)}
      />
    </div>
  )
}
