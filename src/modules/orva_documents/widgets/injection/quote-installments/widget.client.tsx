"use client"
import * as React from 'react'
import Link from 'next/link'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

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

  React.useEffect(() => {
    if (!quoteId) return
    let cancelled = false
    apiCall<{ items: Installment[] }>(`/api/orva_documents/issue-invoice?quoteId=${quoteId}`)
      .then((call) => {
        if (!cancelled && call.ok && call.result) setItems(call.result.items)
      })
      .catch(() => { if (!cancelled) setItems([]) })
    return () => { cancelled = true }
  }, [quoteId])

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
    </div>
  )
}
