"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type Reason = { code: string; label: string }
type NotesResponse = {
  items: Array<{ id: string; number: string; kind: 'credit' | 'debit'; issueDate: string | null; reason: string | null; gross: string; journalNo: string | null }>
  reasons: { credit: Reason[]; debit: Reason[] }
}
type Line = { description: string; quantity: number; unitPriceNet: number }

const fmt = (v: number | string) => Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const today = () => new Date().toISOString().slice(0, 10)

/**
 * ออกใบลดหนี้ / ใบเพิ่มหนี้ against a tax invoice: reason code (ป.82/2542), the
 * correction lines ex-VAT, VAT 7% added like the invoice. The server numbers it
 * in the invoice's series, stores the original-invoice reference and posts it.
 */
export function NoteDialog({ invoiceId, invoiceNumber, open, onOpenChange, onIssued }: {
  invoiceId: string | null
  invoiceNumber?: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onIssued?: () => void
}) {
  const t = useT()
  const router = useRouter()
  const [kind, setKind] = React.useState<'credit' | 'debit'>('credit')
  const [reasonCode, setReasonCode] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [issueDate, setIssueDate] = React.useState(today())
  const [lines, setLines] = React.useState<Line[]>([{ description: '', quantity: 1, unitPriceNet: 0 }])
  const [saving, setSaving] = React.useState(false)

  const existing = useQuery({
    queryKey: ['orva_documents.notes', invoiceId],
    queryFn: () => readApiResultOrThrow<NotesResponse>(`/api/orva_documents/notes?invoiceId=${invoiceId}`),
    enabled: open && Boolean(invoiceId),
  })
  React.useEffect(() => {
    if (open) {
      setKind('credit'); setReasonCode(''); setReason(''); setIssueDate(today())
      setLines([{ description: invoiceNumber ? `ปรับปรุงมูลค่าตามใบกำกับภาษี ${invoiceNumber}` : '', quantity: 1, unitPriceNet: 0 }])
    }
  }, [open, invoiceNumber])

  const net = lines.reduce((s, l) => s + l.quantity * l.unitPriceNet, 0)
  const vat = Math.round(net * 7) / 100
  const reasons = existing.data?.reasons?.[kind] ?? []
  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))

  const submit = async () => {
    if (!invoiceId) return
    if (!reasonCode) { flash(t('orva_documents.note.pickReason', 'เลือกสาเหตุก่อน'), 'error'); return }
    setSaving(true)
    try {
      const res = await apiCall<{ ok: true; number: string; preview: string; accounting?: { ok: boolean; journalNo?: string; reason?: string } }>('/api/orva_documents/notes', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ invoiceId, kind, issueDate, reasonCode, reason: reason || null, lines }),
      })
      if (!res.ok || !res.result) throw new Error((res.result as { error?: string } | undefined)?.error ?? 'failed')
      flash(t('orva_documents.note.issued', 'ออก {number} แล้ว{journal}').replace('{number}', res.result.number).replace('{journal}', res.result.accounting?.ok && res.result.accounting.journalNo ? ` · ลงบัญชี ${res.result.accounting.journalNo}` : ''), 'success')
      onIssued?.()
      onOpenChange(false)
      router.push(res.result.preview)
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('orva_documents.note.title', 'ออกใบลดหนี้ / ใบเพิ่มหนี้')}{invoiceNumber ? ` — ${invoiceNumber}` : ''}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          {existing.data?.items.length ? (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
              <div className="mb-1 font-medium">{t('orva_documents.note.existing', 'ใบที่ออกไปแล้ว')}</div>
              {existing.data.items.map((n) => (
                <div key={n.id} className="flex justify-between gap-3">
                  <span>{n.kind === 'credit' ? t('orva_documents.type.credit_note', 'ใบลดหนี้') : t('orva_documents.type.debit_note', 'ใบเพิ่มหนี้')} {n.number} · {n.issueDate ?? ''}{n.journalNo ? ` · ${n.journalNo}` : ''}</span>
                  <span className="tabular-nums">{fmt(n.gross)}</span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="grid gap-3 md:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span>{t('orva_documents.note.kind', 'ประเภท')}</span>
              <select className="rounded-md border bg-background px-3 py-2" value={kind} onChange={(e) => { setKind(e.target.value as 'credit' | 'debit'); setReasonCode('') }}>
                <option value="credit">{t('orva_documents.type.credit_note', 'ใบลดหนี้')}</option>
                <option value="debit">{t('orva_documents.type.debit_note', 'ใบเพิ่มหนี้')}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 md:col-span-2">
              <span>{t('orva_documents.note.reason', 'สาเหตุ (ตาม ป.82/2542)')}</span>
              <select className="rounded-md border bg-background px-3 py-2" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} required>
                <option value="">—</option>
                {reasons.map((r) => <option key={r.code} value={r.code}>{r.code} · {r.label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span>{t('orva_documents.note.issueDate', 'วันที่ออก')}</span>
              <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 md:col-span-2">
              <span>{t('orva_documents.note.reasonText', 'รายละเอียดเพิ่มเติม (ไม่บังคับ)')}</span>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
            </label>
          </div>
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/50 text-left"><th className="px-2 py-1.5">{t('orva_documents.field.description', 'รายการ')}</th><th className="w-20 px-2 py-1.5">{t('orva_documents.field.quantity', 'จำนวน')}</th><th className="w-36 px-2 py-1.5">{t('orva_documents.note.unitNet', 'มูลค่า/หน่วย (ก่อน VAT)')}</th><th className="w-10" /></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b last:border-b-0">
                    <td className="px-2 py-1"><Input value={l.description} onChange={(e) => update(i, { description: e.target.value })} /></td>
                    <td className="px-2 py-1"><Input type="number" min="0.01" step="1" value={l.quantity} onChange={(e) => update(i, { quantity: Number(e.target.value) })} /></td>
                    <td className="px-2 py-1"><Input type="number" min="0" step="0.01" value={l.unitPriceNet || ''} onChange={(e) => update(i, { unitPriceNet: Number(e.target.value) })} /></td>
                    <td className="px-2 py-1">{lines.length > 1 ? <button type="button" className="text-xs text-muted-foreground hover:text-destructive" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>✕</button> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between px-2 py-1.5 text-xs">
              <button type="button" className="text-primary hover:underline" onClick={() => setLines((ls) => [...ls, { description: '', quantity: 1, unitPriceNet: 0 }])}>{t('orva_documents.note.addLine', '+ เพิ่มบรรทัด')}</button>
              <span className="tabular-nums">{t('orva_documents.field.subtotal', 'รวมเป็นเงิน')} {fmt(net)} · {t('orva_documents.field.vat', 'ภาษีมูลค่าเพิ่ม')} 7% {fmt(vat)} · <strong>{fmt(net + vat)}</strong></span>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{t('orva_documents.note.cancel', 'ยกเลิก')}</Button>
            <Button onClick={submit} disabled={saving || net <= 0}>{t('orva_documents.note.submit', 'ออกเอกสารและลงบัญชี')}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
