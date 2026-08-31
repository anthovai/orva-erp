"use client"
import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  DOCUMENT_TYPES,
  TEMPLATE_IDS,
  type DocumentType,
  type PrintableDocument,
  type TemplateId,
} from '../lib/document'
import { DOCUMENT_TEMPLATES } from './templates'

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, { key: string; fallback: string }> = {
  quotation: { key: 'orva_documents.type.quotation', fallback: 'ใบเสนอราคา' },
  invoice: { key: 'orva_documents.type.invoice', fallback: 'ใบแจ้งหนี้' },
  tax_invoice: { key: 'orva_documents.type.tax_invoice', fallback: 'ใบกำกับภาษี' },
  receipt: { key: 'orva_documents.type.receipt', fallback: 'ใบกำกับภาษี/ใบเสร็จรับเงิน' },
}

type PreviewResponse = { document: PrintableDocument; usedSample: boolean }

/**
 * Review a record's Thai documents without leaving the record.
 *
 * The reference ERPs all put this action on the document itself: Odoo's
 * quotation form carries a Preview button that shows the sheet the customer
 * will see, QuickBooks puts Print-or-Preview on the invoice screen and shows
 * the PDF before sending, and FlowAccount hangs the follow-on documents off
 * the quotation row. The operator's question is "what will this look like?" —
 * asked while looking at the record, so the answer belongs there too.
 *
 * The dialog renders the same template components the preview screen and the
 * server-side PDF use, so what it shows IS the artifact. Printing and email
 * stay on the full preview screen (linked below the sheet): print CSS hides
 * dialogs by design, and the send flow deserves a full page.
 */
export function DocumentReviewDialog({
  documentId,
  open,
  onOpenChange,
  initialType = 'quotation',
}: {
  documentId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  initialType?: DocumentType
}) {
  const t = useT()
  const [type, setType] = React.useState<DocumentType>(initialType)
  const [template, setTemplate] = React.useState<TemplateId | ''>('')
  const [doc, setDoc] = React.useState<PrintableDocument | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams({ type, documentId })
    if (template) params.set('template', template)
    apiCall<PreviewResponse>(`/api/orva_documents/preview?${params.toString()}`)
      .then((call) => {
        if (cancelled) return
        if (call.ok && call.result) setDoc(call.result.document)
        else flash(t('orva_documents.preview.failed', 'ไม่สามารถสร้างตัวอย่างเอกสารได้'), 'error')
      })
      .catch(() => {
        if (!cancelled) flash(t('orva_documents.preview.failed', 'ไม่สามารถสร้างตัวอย่างเอกสารได้'), 'error')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, type, template, documentId, t])

  const selectorParams = () => {
    const params = new URLSearchParams({ type, documentId })
    if (template) params.set('template', template)
    return params.toString()
  }

  const downloadPdf = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/orva_documents/pdf?${selectorParams()}`, { credentials: 'include' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        flash(body?.code === 'pdf_browser_unavailable'
          ? t('orva_documents.pdf.browserMissing', 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่าตัวสร้าง PDF')
          : t('orva_documents.pdf.failed', 'สร้างไฟล์ PDF ไม่สำเร็จ'), 'error')
        return
      }
      const blob = await res.blob()
      const href = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = href
      link.download = decodeURIComponent(
        (res.headers.get('content-disposition') ?? '').split("UTF-8''")[1] ?? 'document.pdf',
      )
      link.click()
      URL.revokeObjectURL(href)
    } finally {
      setBusy(false)
    }
  }

  const Template = doc ? DOCUMENT_TEMPLATES[doc.template].Component : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('orva_documents.review.title', 'ตรวจดูเอกสาร')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t('orva_documents.preview.typeLabel', 'ประเภทเอกสาร')}</span>
            <Select value={type} onValueChange={(value) => setType(value as DocumentType)}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOCUMENT_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(DOCUMENT_TYPE_LABELS[value].key, DOCUMENT_TYPE_LABELS[value].fallback)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t('orva_documents.preview.templateLabel', 'เทมเพลต')}</span>
            {/* empty value = the template the tenant configured for this type */}
            <Select value={template} onValueChange={(value) => setTemplate(value as TemplateId)}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder={t('orva_documents.review.templateDefault', 'ตามที่ตั้งค่าไว้')} />
              </SelectTrigger>
              <SelectContent>
                {TEMPLATE_IDS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(DOCUMENT_TEMPLATES[value].labelKey, DOCUMENT_TEMPLATES[value].fallback)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" asChild>
              <a href={`/backend/documents/preview?${selectorParams()}`}>
                {t('orva_documents.review.openFull', 'เปิดหน้าเต็ม / พิมพ์ / ส่งอีเมล')}
              </a>
            </Button>
            <Button type="button" onClick={downloadPdf} disabled={!doc || busy}>
              {t('orva_documents.preview.downloadPdf', 'ดาวน์โหลด PDF')}
            </Button>
          </div>
        </div>

        {doc && doc.warnings.length > 0 ? (
          <div className="rounded-md border border-status-warning-border bg-status-warning-bg px-4 py-3 text-sm text-status-warning-text">
            <p className="font-semibold">{t('orva_documents.warning.title', 'เอกสารนี้ยังไม่สมบูรณ์ตามข้อกำหนด')}</p>
            <ul className="mt-1 list-inside list-disc">
              {doc.warnings.map((warning) => (
                <li key={warning}>
                  {warning === 'seller_tax_id_missing'
                    ? t('orva_documents.warning.sellerTaxId', 'ยังไม่ได้ตั้งเลขประจำตัวผู้เสียภาษีของกิจการ — ตั้งค่าที่หน้าตั้งค่าเอกสาร')
                    : t('orva_documents.warning.buyerTaxId', 'ลูกค้ารายนี้ยังไม่มีเลขประจำตัวผู้เสียภาษีในระบบ')}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {loading || !doc || !Template ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : (
          <div className="overflow-x-auto rounded-md border bg-muted/30 p-4">
            {/* the real sheet, at A4 proportions — what the PDF will contain */}
            <div className="mx-auto w-[794px] max-w-full bg-card p-10 shadow-sm">
              <Template doc={doc} t={t} />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
