"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type QuoteSummary = { subtotal: number; currencyCode: string; number: string }

const thb = (value: number) => value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * ออกใบแจ้งหนี้งวดจากใบเสนอราคา — the moment the quotation and the invoice
 * part ways. One bill, staged: the operator states the งวด as a percent of
 * the quote's pre-VAT subtotal (or a fixed amount), sees the VAT split before
 * committing, and the server mints the next number in the invoice series and
 * creates the REAL invoice record carrying this quote's customer.
 */
export function IssueInvoiceDialog({
  quoteId,
  open,
  onOpenChange,
}: {
  quoteId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useT()
  const router = useRouter()
  const [mode, setMode] = React.useState<'percent' | 'amount'>('percent')
  const [value, setValue] = React.useState('30')
  const [description, setDescription] = React.useState('')
  const [dueInDays, setDueInDays] = React.useState('7')
  const [quote, setQuote] = React.useState<QuoteSummary | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    apiCall<{ document?: { subtotal?: number; currencyCode?: string; number?: string } }>(
      `/api/orva_documents/preview?type=quotation&documentId=${quoteId}`,
    ).then((call) => {
      if (cancelled || !call.ok || !call.result?.document) return
      setQuote({
        subtotal: Number(call.result.document.subtotal ?? 0),
        currencyCode: String(call.result.document.currencyCode ?? 'THB'),
        number: String(call.result.document.number ?? ''),
      })
    })
    return () => { cancelled = true }
  }, [open, quoteId])

  const numeric = Number(value)
  const net = !quote || !Number.isFinite(numeric) || numeric <= 0
    ? 0
    : mode === 'percent'
      ? Math.round(quote.subtotal * numeric) / 100
      : numeric
  const tax = Math.round(net * 7) / 100
  const gross = Math.round((net + tax) * 100) / 100

  const submit = async () => {
    if (busy || net <= 0) return
    setBusy(true)
    try {
      const res = await fetch('/api/orva_documents/issue-invoice', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          quoteId,
          ...(mode === 'percent' ? { percent: numeric } : { amount: numeric }),
          ...(description.trim() ? { description: description.trim() } : {}),
          dueInDays: Number(dueInDays) || 7,
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.id) {
        flash(t('orva_documents.issue.failed', 'ออกใบแจ้งหนี้ไม่สำเร็จ'), 'error')
        return
      }
      flash(
        t('orva_documents.issue.done', 'ออกใบแจ้งหนี้ {number} แล้ว', { number: body.invoiceNumber }),
        'success',
      )
      onOpenChange(false)
      router.push(`/backend/documents/preview?type=invoice&documentId=${body.id}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('orva_documents.issue.title', 'ออกใบแจ้งหนี้งวด')}</DialogTitle>
        </DialogHeader>

        {quote ? (
          <p className="text-sm text-muted-foreground">
            {t('orva_documents.issue.fromQuote', 'จากใบเสนอราคา {number} · ยอดก่อนภาษี {subtotal}', {
              number: quote.number,
              subtotal: `${thb(quote.subtotal)} ${quote.currencyCode}`,
            })}
          </p>
        ) : null}

        <div className="flex items-end gap-2">
          <div className="flex rounded-md border p-0.5">
            <Button
              type="button"
              size="sm"
              variant={mode === 'percent' ? 'default' : 'ghost'}
              onClick={() => setMode('percent')}
            >
              {t('orva_documents.issue.percent', '% ของยอด')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === 'amount' ? 'default' : 'ghost'}
              onClick={() => setMode('amount')}
            >
              {t('orva_documents.issue.amount', 'จำนวนเงิน')}
            </Button>
          </div>
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              {mode === 'percent'
                ? t('orva_documents.issue.percentLabel', 'เปอร์เซ็นต์ของยอดก่อนภาษี')
                : t('orva_documents.issue.amountLabel', 'ยอดก่อนภาษี (บาท)')}
            </span>
            <Input inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">
            {t('orva_documents.issue.descriptionLabel', 'รายละเอียดงวด (เว้นว่าง = งวดที่ N อัตโนมัติ)')}
          </span>
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t('orva_documents.issue.descriptionPlaceholder', 'เช่น งวดที่ 1 (30% เมื่อเริ่มงาน)')}
          />
        </label>

        <label className="flex w-40 flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t('orva_documents.issue.dueLabel', 'ครบกำหนดใน (วัน)')}</span>
          <Input inputMode="numeric" value={dueInDays} onChange={(event) => setDueInDays(event.target.value)} />
        </label>

        {/* the VAT split the invoice will carry — visible before committing */}
        <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('orva_documents.field.subtotal', 'รวมเป็นเงิน')}</span>
            <span className="tabular-nums">{thb(net)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('orva_documents.field.vat', 'ภาษีมูลค่าเพิ่ม')} 7%</span>
            <span className="tabular-nums">{thb(tax)}</span>
          </div>
          <div className="mt-1 flex justify-between font-semibold">
            <span>{t('orva_documents.field.grandTotal', 'จำนวนเงินรวมทั้งสิ้น')}</span>
            <span className="orva-ledger-total tabular-nums">{thb(gross)}</span>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('orva_documents.issue.cancel', 'ยกเลิก')}
          </Button>
          <Button type="button" onClick={submit} disabled={busy || net <= 0}>
            {t('orva_documents.issue.submit', 'ออกใบแจ้งหนี้')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
