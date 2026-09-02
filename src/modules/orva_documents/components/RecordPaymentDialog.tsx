"use client"
import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type PaymentContext = {
  id: string
  invoiceNumber: string
  gross: number
  net: number
  tax: number
  outstanding: number
  paidDate: string | null
  dueDate: string | null
  updatedAt: string | null
}

const thb = (value: number) => value.toLocaleString('th-TH', { minimumFractionDigits: 2 })
const today = () => new Date().toISOString().slice(0, 10)

/**
 * The FlowAccount step after the customer's slip arrives: stamp the paid
 * date, record cash received, and account for the 3% withholding tax (of the
 * pre-VAT amount) that Thai corporate buyers deduct on services. Cash + WHT
 * settle the bill; the receipt then prints with the paid date.
 */
export function RecordPaymentDialog({
  invoiceId,
  open,
  onOpenChange,
  onRecorded,
}: {
  invoiceId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onRecorded?: () => void
}) {
  const t = useT()
  const [context, setContext] = React.useState<PaymentContext | null>(null)
  const [paidDate, setPaidDate] = React.useState(today())
  const [withWht, setWithWht] = React.useState(true)
  const [amount, setAmount] = React.useState('')
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const whtAmount = React.useMemo(() => {
    if (!context || !withWht) return 0
    return Math.round(context.net * 3) / 100
  }, [context, withWht])

  React.useEffect(() => {
    if (!open || !invoiceId) return
    let cancelled = false
    setContext(null)
    setError(null)
    setPaidDate(today())
    setNote('')
    apiCall<PaymentContext>(`/api/orva_documents/record-payment?invoiceId=${invoiceId}`)
      .then((call) => {
        if (cancelled) return
        if (!call.ok || !call.result) {
          setError(t('orva_documents.payment.loadFailed', 'โหลดข้อมูลใบแจ้งหนี้ไม่สำเร็จ'))
          return
        }
        setContext(call.result)
        const wht = Math.round(call.result.net * 3) / 100
        setAmount(String(Math.round((call.result.gross - wht) * 100) / 100))
      })
      .catch(() => { if (!cancelled) setError(t('orva_documents.payment.loadFailed', 'โหลดข้อมูลใบแจ้งหนี้ไม่สำเร็จ')) })
    return () => { cancelled = true }
  }, [open, invoiceId, t])

  // keep the suggested amount in sync when the WHT toggle flips
  React.useEffect(() => {
    if (!context) return
    setAmount(String(Math.round((context.gross - whtAmount) * 100) / 100))
  }, [context, whtAmount])

  const submit = async () => {
    if (!invoiceId || !context) return
    const parsed = Number(amount)
    if (!(parsed > 0)) {
      setError(t('orva_documents.payment.amountInvalid', 'จำนวนเงินต้องมากกว่า 0'))
      return
    }
    setBusy(true)
    setError(null)
    const call = await apiCall<{ outstanding: number }>('/api/orva_documents/record-payment', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        invoiceId,
        paidDate,
        amountReceived: parsed,
        whtAmount,
        updatedAt: context.updatedAt,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    })
    setBusy(false)
    if (!call.ok) {
      setError(
        call.status === 409
          ? t('orva_documents.payment.conflict', 'ใบนี้ถูกแก้ไขพร้อมกัน — โหลดใหม่แล้วลองอีกครั้ง')
          : t('orva_documents.payment.saveFailed', 'บันทึกรับชำระไม่สำเร็จ'),
      )
      return
    }
    flash(t('orva_documents.payment.saved', 'บันทึกรับชำระแล้ว'), 'success')
    onOpenChange(false)
    onRecorded?.()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('orva_documents.payment.title', 'บันทึกรับชำระ')}
            {context ? ` — ${context.invoiceNumber}` : ''}
          </DialogTitle>
        </DialogHeader>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {context ? (
          <div className="space-y-4">
            {context.paidDate ? (
              <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                {t('orva_documents.payment.alreadyPaid', 'ใบนี้บันทึกรับชำระไว้แล้วเมื่อ {date} — บันทึกใหม่จะแทนที่ของเดิม', {
                  date: context.paidDate,
                })}
              </p>
            ) : null}
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <span className="text-muted-foreground">{t('orva_documents.field.grandTotal', 'จำนวนเงินรวมทั้งสิ้น')}</span>
              <span className="text-right tabular-nums">{thb(context.gross)}</span>
              <span className="text-muted-foreground">
                {t('orva_documents.payment.wht', 'หักภาษี ณ ที่จ่าย 3% (ของยอดก่อน VAT)')}
              </span>
              <span className="text-right tabular-nums">{withWht ? `-${thb(whtAmount)}` : '—'}</span>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={withWht}
                onChange={(event) => setWithWht(event.target.checked)}
              />
              {t('orva_documents.payment.whtToggle', 'ลูกค้าหักภาษี ณ ที่จ่าย 3%')}
            </label>
            <div className="grid gap-1">
              <label htmlFor="orva-payment-date" className="text-sm font-medium">
                {t('orva_documents.field.paidDate', 'วันที่รับชำระ')}
              </label>
              <Input
                id="orva-payment-date"
                type="date"
                value={paidDate}
                onChange={(event) => setPaidDate(event.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <label htmlFor="orva-payment-amount" className="text-sm font-medium">
                {t('orva_documents.payment.amount', 'ยอดเงินที่ได้รับจริง (บาท)')}
              </label>
              <Input
                id="orva-payment-amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <label htmlFor="orva-payment-note" className="text-sm font-medium">
                {t('orva_documents.payment.note', 'บันทึกเพิ่มเติม (เช่น ธนาคาร/เลขที่รายการ)')}
              </label>
              <Input
                id="orva-payment-note"
                value={note}
                maxLength={500}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                {t('orva_documents.dialog.close', 'ปิด')}
              </Button>
              <Button onClick={() => { void submit() }} disabled={busy}>
                {busy
                  ? t('orva_documents.payment.saving', 'กำลังบันทึก…')
                  : t('orva_documents.payment.submit', 'บันทึกรับชำระ')}
              </Button>
            </div>
          </div>
        ) : error ? null : (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {t('orva_documents.preview.loading', 'กำลังโหลด…')}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
