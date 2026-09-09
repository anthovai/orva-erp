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

type DeliveryContext = {
  id: string
  invoiceNumber: string
  issueDate: string | null
  suggestedAddress: string | null
  delivery: {
    deliveredOn: string | null
    carrier: string | null
    trackingNumbers: string[]
    address: string | null
    note: string | null
    showPrices: boolean
  }
  updatedAt: string | null
}

const today = () => new Date().toISOString().slice(0, 10)

/**
 * บันทึกการส่งของ — the facts the ใบส่งของ prints, captured once.
 *
 * The delivery date is the point of it: for goods that date is the VAT point,
 * so it defaults to today rather than to blank. There is deliberately no
 * receiver-name field — invoice metadata is not encrypted at rest (Q-004), so
 * the sheet leaves a line for a handwritten signature instead.
 */
export function DeliveryFactsDialog({
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
  const [context, setContext] = React.useState<DeliveryContext | null>(null)
  const [deliveredOn, setDeliveredOn] = React.useState('')
  const [carrier, setCarrier] = React.useState('')
  const [tracking, setTracking] = React.useState('')
  const [address, setAddress] = React.useState('')
  const [note, setNote] = React.useState('')
  const [showPrices, setShowPrices] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open || !invoiceId) return
    let cancelled = false
    setContext(null)
    setError(null)
    apiCall<DeliveryContext>(`/api/orva_documents/delivery-facts?invoiceId=${invoiceId}`)
      .then((call) => {
        if (cancelled) return
        if (!call.ok || !call.result) {
          setError(t('orva_documents.delivery.loadFailed', 'โหลดข้อมูลใบแจ้งหนี้ไม่สำเร็จ'))
          return
        }
        const facts = call.result.delivery
        setContext(call.result)
        // Recorded facts win; otherwise today's date, because the sheet is
        // usually filled in on the day the van leaves.
        setDeliveredOn(facts.deliveredOn ?? today())
        setCarrier(facts.carrier ?? '')
        setTracking(facts.trackingNumbers.join(', '))
        setAddress(facts.address ?? call.result.suggestedAddress ?? '')
        setNote(facts.note ?? '')
        setShowPrices(facts.showPrices)
      })
      .catch(() => { if (!cancelled) setError(t('orva_documents.delivery.loadFailed', 'โหลดข้อมูลใบแจ้งหนี้ไม่สำเร็จ')) })
    return () => { cancelled = true }
  }, [open, invoiceId, t])

  const submit = async () => {
    if (!invoiceId || !context) return
    setBusy(true)
    setError(null)
    const call = await apiCall<{ id: string }>('/api/orva_documents/delivery-facts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        invoiceId,
        updatedAt: context.updatedAt,
        deliveredOn: deliveredOn || null,
        carrier: carrier.trim() || null,
        // one field, several parcels: comma or newline separated
        trackingNumbers: tracking.split(/[,\n]/).map((value) => value.trim()).filter(Boolean),
        address: address.trim() || null,
        note: note.trim() || null,
        showPrices,
      }),
    })
    setBusy(false)
    if (!call.ok) {
      setError(
        call.status === 409
          ? t('orva_documents.delivery.conflict', 'ใบนี้ถูกแก้ไขพร้อมกัน — ปิดแล้วเปิดใหม่เพื่อดูข้อมูลล่าสุด')
          : t('orva_documents.delivery.saveFailed', 'บันทึกการส่งของไม่สำเร็จ'),
      )
      return
    }
    flash(t('orva_documents.delivery.saved', 'บันทึกการส่งของแล้ว'), 'success')
    onOpenChange(false)
    onRecorded?.()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('orva_documents.delivery.dialogTitle', 'บันทึกการส่งของ')}
            {context ? ` — ${context.invoiceNumber}` : ''}
          </DialogTitle>
        </DialogHeader>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        {context ? (
          <div className="space-y-4">
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
              {t(
                'orva_documents.delivery.hint',
                'วันที่ส่งของคือจุดรับรู้ภาษีของสินค้า — ใบส่งของจะพิมพ์ข้อมูลนี้ และเว้นช่องให้ผู้รับลงลายมือชื่อเอง (ระบบไม่เก็บชื่อผู้รับ)',
              )}
            </p>
            <div className="grid gap-1">
              <label htmlFor="orva-delivery-date" className="text-sm font-medium">
                {t('orva_documents.delivery.deliveredOn', 'วันที่ส่งของ')}
              </label>
              <Input
                id="orva-delivery-date"
                type="date"
                value={deliveredOn}
                onChange={(event) => setDeliveredOn(event.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <label htmlFor="orva-delivery-carrier" className="text-sm font-medium">
                {t('orva_documents.delivery.carrier', 'ผู้ขนส่ง/พาหนะ')}
              </label>
              <Input
                id="orva-delivery-carrier"
                value={carrier}
                maxLength={200}
                placeholder={t('orva_documents.delivery.carrierHint', 'เช่น รถบริษัท (ทะเบียน 1กก-1234) หรือ Kerry')}
                onChange={(event) => setCarrier(event.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <label htmlFor="orva-delivery-tracking" className="text-sm font-medium">
                {t('orva_documents.delivery.tracking', 'เลขติดตามพัสดุ')}
              </label>
              <Input
                id="orva-delivery-tracking"
                value={tracking}
                onChange={(event) => setTracking(event.target.value)}
                placeholder={t('orva_documents.delivery.trackingHint', 'หลายเลขคั่นด้วยเครื่องหมายจุลภาค')}
              />
            </div>
            <div className="grid gap-1">
              <label htmlFor="orva-delivery-address" className="text-sm font-medium">
                {t('orva_documents.delivery.address', 'สถานที่ส่ง')}
              </label>
              <Input
                id="orva-delivery-address"
                value={address}
                maxLength={500}
                onChange={(event) => setAddress(event.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <label htmlFor="orva-delivery-note" className="text-sm font-medium">
                {t('orva_documents.delivery.note', 'หมายเหตุการส่ง')}
              </label>
              <Input
                id="orva-delivery-note"
                value={note}
                maxLength={500}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showPrices}
                onChange={(event) => setShowPrices(event.target.checked)}
              />
              {t('orva_documents.delivery.showPrices', 'พิมพ์ราคาบนใบส่งของ')}
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                {t('orva_documents.dialog.close', 'ปิด')}
              </Button>
              <Button onClick={() => { void submit() }} disabled={busy}>
                {busy
                  ? t('orva_documents.delivery.saving', 'กำลังบันทึก…')
                  : t('orva_documents.delivery.submit', 'บันทึกการส่งของ')}
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
