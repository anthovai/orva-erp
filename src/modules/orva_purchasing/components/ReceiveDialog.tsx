"use client"
import * as React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type ReceivableLine = {
  id: string
  lineNo: number
  kind: string
  description: string
  unit: string | null
  unitPrice: number
  quantity: number
  receivedQty: number
  remainingQty: number
}

export type ReceiveLinePayload = {
  lineId: string
  quantity: number
  lotNumber?: string | null
  manufacturedOn?: string | null
  expiresOn?: string | null
  unitCost?: number | null
}

type Draft = {
  quantity: string
  lotNumber: string
  manufacturedOn: string
  expiresOn: string
  unitCost: string
}

const today = () => new Date().toISOString().slice(0, 10)
const qty = (value: number) => value.toLocaleString('th-TH', { maximumFractionDigits: 4 })

/**
 * Recording a delivery.
 *
 * It offers only what is still outstanding, prefilled with the whole
 * remainder, because the common case is "the order arrived" and the unusual
 * one is a partial. A goods line asks for the lot number, and for
 * manufactured/expiry dates while the box is in the operator's hand — those
 * are what the expiry warnings and the FDA paper trail later depend on, and
 * nobody goes back for them.
 *
 * The unit cost is prefilled from the ordered price and stays editable: the
 * stock valuation should follow what the goods actually cost, and the vendor
 * sometimes disagrees with the order.
 *
 * Client-side checks are a courtesy; the server holds the line under a row
 * lock and answers 409 on an over-receipt, which is what actually protects it.
 */
export function ReceiveDialog({
  open,
  onOpenChange,
  poNumber,
  lines,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  poNumber: string
  lines: ReceivableLine[]
  onSubmit: (receivedOn: string, payload: ReceiveLinePayload[]) => Promise<void>
}) {
  const t = useT()
  const outstanding = React.useMemo(() => lines.filter((line) => line.remainingQty > 0), [lines])
  const [receivedOn, setReceivedOn] = React.useState(today())
  const [busy, setBusy] = React.useState(false)
  const [drafts, setDrafts] = React.useState<Record<string, Draft>>({})

  React.useEffect(() => {
    if (!open) return
    setReceivedOn(today())
    setDrafts(
      Object.fromEntries(
        outstanding.map((line) => [
          line.id,
          {
            quantity: String(line.remainingQty),
            lotNumber: '',
            manufacturedOn: '',
            expiresOn: '',
            unitCost: String(line.unitPrice),
          },
        ]),
      ),
    )
  }, [open, outstanding])

  const update = (lineId: string, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [lineId]: { ...prev[lineId], ...patch } }))

  const payload = outstanding
    .map((line) => ({ line, draft: drafts[line.id] }))
    .filter(({ draft }) => draft && Number(draft.quantity) > 0)

  const tooMany = payload.filter(({ line, draft }) => Number(draft.quantity) > line.remainingQty)
  const missingLot = payload.filter(({ line, draft }) => line.kind === 'goods' && !draft.lotNumber.trim())
  const problem =
    tooMany.length > 0
      ? t('orva_purchasing.receive.tooMany', 'รับเกินจำนวนที่เหลือในบรรทัด {n}').replace(
          '{n}',
          tooMany.map(({ line }) => line.lineNo).join(', '),
        )
      : missingLot.length > 0
        ? t('orva_purchasing.receive.needLot', 'ใส่เลขล็อตของบรรทัด {n}').replace(
            '{n}',
            missingLot.map(({ line }) => line.lineNo).join(', '),
          )
        : payload.length === 0
          ? t('orva_purchasing.receive.needQuantity', 'ใส่จำนวนที่รับอย่างน้อยหนึ่งบรรทัด')
          : null

  const submit = async () => {
    if (problem) return
    setBusy(true)
    try {
      await onSubmit(
        receivedOn,
        payload.map(({ line, draft }) => ({
          lineId: line.id,
          quantity: Number(draft.quantity),
          lotNumber: line.kind === 'goods' ? draft.lotNumber.trim() : null,
          manufacturedOn: draft.manufacturedOn || null,
          expiresOn: draft.expiresOn || null,
          unitCost: draft.unitCost === '' ? null : Number(draft.unitCost),
        })),
      )
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {t('orva_purchasing.receive.title', 'รับของเข้าคลัง')} · {poNumber}
          </DialogTitle>
        </DialogHeader>
        <div
          className="flex flex-col gap-4"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              void submit()
            }
          }}
        >
          <label className="flex max-w-xs flex-col gap-1 text-sm">
            <span className="font-medium">{t('orva_purchasing.receive.receivedOn', 'วันที่รับของ')}</span>
            <Input type="date" value={receivedOn} onChange={(event) => setReceivedOn(event.target.value)} />
          </label>

          {outstanding.length === 0 ? (
            <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              {t('orva_purchasing.receive.nothingLeft', 'รับของครบทุกบรรทัดแล้ว')}
            </p>
          ) : (
            <div className="flex max-h-96 flex-col gap-3 overflow-y-auto">
              {outstanding.map((line) => {
                const draft = drafts[line.id]
                if (!draft) return null
                return (
                  <div key={line.id} className="grid gap-3 rounded-md border p-3 md:grid-cols-12">
                    <div className="md:col-span-4">
                      <span className="block text-sm font-medium">{line.description}</span>
                      <span className="text-xs text-muted-foreground">
                        {t('orva_purchasing.lines.ordered', 'สั่ง')} {qty(line.quantity)}
                        {line.unit ? ` ${line.unit}` : ''} ·{' '}
                        {t('orva_purchasing.lines.remaining', 'เหลือ')} {qty(line.remainingQty)}
                        {line.kind === 'service' ? ` · ${t('orva_purchasing.field.service', 'บริการ')}` : ''}
                      </span>
                    </div>
                    <label className="md:col-span-2">
                      <span className="mb-1 block text-xs font-medium text-muted-foreground">
                        {t('orva_purchasing.receive.quantity', 'รับจำนวน')}
                      </span>
                      <Input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={draft.quantity}
                        onChange={(event) => update(line.id, { quantity: event.target.value })}
                      />
                    </label>
                    {line.kind === 'goods' ? (
                      <>
                        <label className="md:col-span-2">
                          <span className="mb-1 block text-xs font-medium text-muted-foreground">
                            {t('orva_purchasing.receive.lotNumber', 'เลขล็อต')}
                          </span>
                          <Input
                            value={draft.lotNumber}
                            onChange={(event) => update(line.id, { lotNumber: event.target.value })}
                          />
                        </label>
                        <label className="md:col-span-2">
                          <span className="mb-1 block text-xs font-medium text-muted-foreground">
                            {t('orva_purchasing.receive.expiresOn', 'วันหมดอายุ')}
                          </span>
                          <Input
                            type="date"
                            value={draft.expiresOn}
                            onChange={(event) => update(line.id, { expiresOn: event.target.value })}
                          />
                        </label>
                        <label className="md:col-span-2">
                          <span className="mb-1 block text-xs font-medium text-muted-foreground">
                            {t('orva_purchasing.receive.unitCost', 'ต้นทุน/หน่วย')}
                          </span>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={draft.unitCost}
                            onChange={(event) => update(line.id, { unitCost: event.target.value })}
                          />
                        </label>
                        <label className="md:col-span-2">
                          <span className="mb-1 block text-xs font-medium text-muted-foreground">
                            {t('orva_purchasing.receive.manufacturedOn', 'วันผลิต')}
                          </span>
                          <Input
                            type="date"
                            value={draft.manufacturedOn}
                            onChange={(event) => update(line.id, { manufacturedOn: event.target.value })}
                          />
                        </label>
                      </>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}

          {problem ? <p className="text-sm text-status-warning-fg">{problem}</p> : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              {t('orva_purchasing.cancel', 'ยกเลิก')}
            </Button>
            <Button onClick={submit} disabled={busy || problem != null}>
              {busy ? t('orva_purchasing.saving', 'กำลังบันทึก…') : t('orva_purchasing.receive.confirm', 'บันทึกการรับของ')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default ReceiveDialog
