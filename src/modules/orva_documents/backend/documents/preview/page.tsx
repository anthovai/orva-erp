"use client"
import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@/components/orva/Page'
import { Button } from '@open-mercato/ui/primitives/button'
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
import { Input } from '@open-mercato/ui/primitives/input'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DOCUMENT_TYPES, TEMPLATE_IDS, typesForSourceKind, type DocumentType, type PrintableDocument, type TemplateId } from '../../../lib/document'
import { DOCUMENT_TEMPLATES, templateComponentFor } from '../../../components/templates'
import { A4_SHEET_MIN_HEIGHT } from '../../../lib/sheet'

type SourceOption = { id: string; kind?: string; number: string; issueDate: string | null; customerName: string | null }
type PreviewResponse = { document: PrintableDocument; sources: SourceOption[]; usedSample: boolean; sourceKind?: string }

const TYPE_LABELS: Record<DocumentType, { key: string; fallback: string }> = {
  quotation: { key: 'orva_documents.type.quotation', fallback: 'ใบเสนอราคา' },
  invoice: { key: 'orva_documents.type.invoice', fallback: 'ใบแจ้งหนี้' },
  tax_invoice: { key: 'orva_documents.type.tax_invoice', fallback: 'ใบกำกับภาษี / ใบแจ้งหนี้' },
  receipt: { key: 'orva_documents.type.receipt', fallback: 'ใบกำกับภาษี/ใบเสร็จรับเงิน' },
  abbreviated_tax_invoice: { key: 'orva_documents.type.abbreviated_tax_invoice', fallback: 'ใบกำกับภาษีอย่างย่อ' },
  credit_note: { key: 'orva_documents.type.credit_note', fallback: 'ใบลดหนี้' },
  debit_note: { key: 'orva_documents.type.debit_note', fallback: 'ใบเพิ่มหนี้' },
  billing_note: { key: 'orva_documents.type.billing_note', fallback: 'ใบวางบิล' },
  statement: { key: 'orva_documents.type.statement', fallback: 'ใบแจ้งยอด' },
  payslip: { key: 'orva_documents.type.payslip', fallback: 'สลิปเงินเดือน' },
  purchase_order: { key: 'orva_documents.type.purchase_order', fallback: 'ใบสั่งซื้อ' },
  delivery_note: { key: 'orva_documents.type.delivery_note', fallback: 'ใบส่งของ' },
  lot_label: { key: 'orva_documents.type.lot_label', fallback: 'ฉลากล็อต' },
}

const SAMPLE_VALUE = '__sample__'

function isDocumentType(value: string | null): value is DocumentType {
  return !!value && (DOCUMENT_TYPES as readonly string[]).includes(value)
}
function isTemplateId(value: string | null): value is TemplateId {
  return !!value && (TEMPLATE_IDS as readonly string[]).includes(value)
}

export default function DocumentPreviewPage() {
  const t = useT()
  // The server-side PDF renderer prints this very screen, so the selection
  // has to come from the URL — otherwise every export would silently render
  // the default view instead of what was asked for.
  const searchParams = useSearchParams()
  const [type, setType] = React.useState<DocumentType>(() => {
    const value = searchParams.get('type')
    return isDocumentType(value) ? value : 'quotation'
  })
  // '' = the template configured per document type in settings — forcing
  // 'classic' here silently overrode the tenant's configured default
  const [template, setTemplate] = React.useState<TemplateId | ''>(() => {
    const value = searchParams.get('template')
    return isTemplateId(value) ? value : ''
  })
  const [sourceId, setSourceId] = React.useState<string>(() => searchParams.get('documentId') ?? SAMPLE_VALUE)
  const [brand, setBrand] = React.useState<string>(() => searchParams.get('brand') ?? '')
  const [brands, setBrands] = React.useState<Array<{ code: string; name: string }>>([])
  const [data, setData] = React.useState<PreviewResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailed(false)
    const params = new URLSearchParams({ type })
    if (template) params.set('template', template)
    if (sourceId !== SAMPLE_VALUE) params.set('documentId', sourceId)
    if (brand) params.set('brand', brand)
    apiCall<PreviewResponse>(`/api/orva_documents/preview?${params.toString()}`)
      .then((call) => {
        if (cancelled) return
        if (call.ok && call.result) setData(call.result)
        else setFailed(true)
      })
      .catch(() => { if (!cancelled) setFailed(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [type, template, sourceId, brand])

  const [busy, setBusy] = React.useState(false)
  const [emailTo, setEmailTo] = React.useState('')
  // e-Tax Invoice by Email: offered only when the RD-registered sender is set
  const [etaxConfigured, setEtaxConfigured] = React.useState(false)
  const [etax, setEtax] = React.useState(false)
  React.useEffect(() => {
    let cancelled = false
    apiCall<{ etaxSenderEmail: string | null }>('/api/orva_documents/settings')
      .then((call) => {
        if (!cancelled && call.ok) setEtaxConfigured(!!call.result?.etaxSenderEmail)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  React.useEffect(() => {
    let cancelled = false
    apiCall<{ items: Array<{ code: string; name: string }> }>('/api/orva_documents/brands')
      .then((call) => { if (!cancelled && call.ok) setBrands(call.result?.items ?? []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  const isTaxType = type === 'tax_invoice' || type === 'receipt'
  const etaxAvailable = etaxConfigured && isTaxType && sourceId !== SAMPLE_VALUE

  const selectorParams = React.useCallback(() => {
    const params = new URLSearchParams({ type })
    if (template) params.set('template', template)
    if (sourceId !== SAMPLE_VALUE) params.set('documentId', sourceId)
    if (brand) params.set('brand', brand)
    return params
  }, [type, template, sourceId, brand])

  // Server-rendered PDF: the browser downloads the same sheet it is showing.
  // etax = the PDF/A-3 variant with the ขมธอ.3-2560 XML embedded.
  const downloadPdf = async (asEtax = false) => {
    if (busy) return
    setBusy(true)
    try {
      const params = selectorParams()
      if (asEtax) params.set('etax', '1')
      const res = await fetch(`/api/orva_documents/pdf?${params.toString()}`, { credentials: 'include' })
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
      link.download = decodeURIComponent((res.headers.get('content-disposition') ?? '').split("UTF-8''")[1] ?? 'document.pdf')
      link.click()
      URL.revokeObjectURL(href)
    } finally {
      setBusy(false)
    }
  }

  // Customer link: minted server-side (rotates the acceptance token), copied
  // to the clipboard here. Rotation means an earlier link stops working — the
  // flash says so instead of leaving the operator to find out from a customer.
  // A ใบส่งของ printed from an invoice gets its own link (share-document), since
  // an invoice carries no acceptance token; the button and the rotation
  // warning are the same, so the operator learns one gesture.
  const canShareDocument = data?.sourceKind === 'invoice' && type === 'delivery_note'
  const canShare = sourceId !== SAMPLE_VALUE && (data?.sourceKind === 'quote' || canShareDocument)

  const copyCustomerLink = async () => {
    if (busy || !canShare) return
    setBusy(true)
    try {
      const call = await apiCall<{ url: string; validUntil: string | null }>(
        canShareDocument ? '/api/orva_documents/share-document' : '/api/orva_documents/share',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(canShareDocument ? { documentId: sourceId, type } : { quoteId: sourceId }),
        },
      )
      if (!call.ok || !call.result) {
        flash(t('orva_documents.share.failed', 'สร้างลิงก์ลูกค้าไม่สำเร็จ'), 'error')
        return
      }
      await navigator.clipboard.writeText(call.result.url).catch(() => {
        window.prompt(t('orva_documents.share.copyManually', 'คัดลอกลิงก์นี้'), call.result!.url)
      })
      flash(
        canShareDocument
          ? t('orva_documents.share.copiedDocument', 'คัดลอกลิงก์แล้ว — ลิงก์เดิมของเอกสารนี้จะใช้ไม่ได้อีก')
          : t('orva_documents.share.copied', 'คัดลอกลิงก์แล้ว — ลิงก์เดิมที่เคยส่งจะใช้ไม่ได้อีก'),
        'success',
      )
    } finally {
      setBusy(false)
    }
  }

  const sendPdf = async () => {
    if (busy || !emailTo.trim()) return
    setBusy(true)
    try {
      const params = selectorParams()
      const res = await fetch('/api/orva_documents/send', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          to: emailTo.trim(), type, template,
          documentId: params.get('documentId') ?? undefined,
          ...(etax && etaxAvailable ? { etax: true } : {}),
        }),
      })
      const body = await res.json().catch(() => null)
      if (res.ok) {
        flash(
          body?.etax
            ? t('orva_documents.etax.sent', 'ส่ง e-Tax Invoice แล้ว — สำเนาถึงระบบประทับเวลา ETDA')
            : t('orva_documents.email.sent', 'ส่งเอกสารทางอีเมลแล้ว'),
          'success',
        )
        setEmailTo('')
      } else {
        flash(body?.code === 'pdf_browser_unavailable'
          ? t('orva_documents.pdf.browserMissing', 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่าตัวสร้าง PDF')
          : t('orva_documents.email.failed', 'ส่งอีเมลไม่สำเร็จ'), 'error')
      }
    } finally {
      setBusy(false)
    }
  }
  const doc = data?.document ?? null
  // with no explicit choice the server already applied the configured
  // template — render whichever the document says it is
  // '' must fall through too, hence || rather than ??
  // The whole document decides the sheet: a payslip, a label sheet and a
  // delivery note each override the template id, and passing only `isPayslip`
  // here silently rendered the label sheet as a blank invoice (G3, 2026-09-09).
  const Template = templateComponentFor(doc ?? { template: (template || 'classic') as TemplateId })

  return (
    <Page>
      <PageBody>
        <div className="flex flex-col gap-4">
          {/* controls — hidden when printing so only the sheet reaches paper */}
          <div className="flex flex-wrap items-end gap-3 print:hidden">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{t('orva_documents.preview.typeLabel', 'ประเภทเอกสาร')}</span>
              <Select value={type} onValueChange={(value) => setType(value as DocumentType)}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {typesForSourceKind(data?.sourceKind).map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(TYPE_LABELS[value].key, TYPE_LABELS[value].fallback)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{t('orva_documents.preview.templateLabel', 'เทมเพลต')}</span>
              <Select value={template} onValueChange={(value) => setTemplate(value as TemplateId)}>
                <SelectTrigger className="w-56">
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

            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{t('orva_documents.preview.sourceLabel', 'ข้อมูลจากเอกสาร')}</span>
              <Select
                value={sourceId}
                onValueChange={(next) => {
                  // switching between record kinds snaps the type to one the
                  // kind can print, instead of surfacing the API's 400
                  const picked = (data?.sources ?? []).find((source) => source.id === next)
                  if (picked?.kind === 'invoice' && type === 'quotation') setType('invoice')
                  if (picked?.kind === 'quote' && type !== 'quotation') setType('quotation')
                  setSourceId(next)
                }}
              >
                <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={SAMPLE_VALUE}>{t('orva_documents.preview.sample', 'ข้อมูลตัวอย่าง')}</SelectItem>
                  {(data?.sources ?? []).map((source) => (
                    <SelectItem key={source.id} value={source.id}>
                      {source.number}{source.customerName ? ` · ${source.customerName}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            {brands.length ? (
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">{t('orva_documents.preview.brandLabel', 'แบรนด์')}</span>
                <Select value={brand || '__default__'} onValueChange={(next) => setBrand(next === '__default__' ? '' : next)}>
                  <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">{t('orva_documents.preview.brandDefault', 'แบรนด์หลัก (ตั้งค่าเอกสาร)')}</SelectItem>
                    {brands.map((b) => (
                      <SelectItem key={b.code} value={b.code}>{b.code} · {b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {sourceId !== SAMPLE_VALUE ? (
                  <span className="text-xs text-muted-foreground">{t('orva_documents.preview.brandFromNumber', 'เอกสารจริงใช้แบรนด์ตามเลขที่ของตัวเอง')}</span>
                ) : null}
              </label>
            ) : null}

            <Button type="button" variant="outline" onClick={() => window.print()} disabled={!doc}>
              {t('orva_documents.preview.print', 'พิมพ์')}
            </Button>
            <Button type="button" onClick={() => downloadPdf(false)} disabled={!doc || busy}>
              {t('orva_documents.preview.downloadPdf', 'ดาวน์โหลด PDF')}
            </Button>
            {isTaxType && sourceId !== SAMPLE_VALUE ? (
              <Button type="button" variant="outline" onClick={() => downloadPdf(true)} disabled={!doc || busy}>
                {t('orva_documents.etax.downloadPdfA3', 'ดาวน์โหลด PDF/A-3 (e-Tax)')}
              </Button>
            ) : null}
            {canShare ? (
              <Button
                type="button"
                variant="outline"
                onClick={copyCustomerLink}
                disabled={busy}
                title={canShareDocument ? t('orva_documents.share.deliveryNoteHint', 'ลิงก์ใบส่งของเปิดดูได้โดยไม่ต้องเข้าระบบ ไม่แสดงราคา และหมดอายุใน 30 วัน') : undefined}
              >
                {t('orva_documents.share.copyLink', 'คัดลอกลิงก์ลูกค้า')}
              </Button>
            ) : null}
          </div>

          {/* email the rendered PDF straight to the customer */}
          <div className="flex flex-wrap items-end gap-3 print:hidden">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{t('orva_documents.preview.emailLabel', 'ส่งอีเมลถึง')}</span>
              <Input
                type="email"
                className="w-72"
                placeholder="customer@example.co.th"
                value={emailTo}
                onChange={(event) => setEmailTo(event.target.value)}
              />
            </label>
            <Button type="button" variant="outline" onClick={sendPdf} disabled={!doc || busy || !emailTo.trim()}>
              {t('orva_documents.preview.sendEmail', 'ส่งเอกสารทางอีเมล')}
            </Button>
            {etaxAvailable ? (
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input type="checkbox" checked={etax} onChange={(event) => setEtax(event.target.checked)} />
                {t('orva_documents.etax.toggle', 'ส่งเข้าระบบ e-Tax (CC ประทับเวลา ETDA)')}
              </label>
            ) : null}
          </div>

          {data?.usedSample ? (
            <p className="text-xs text-muted-foreground print:hidden">
              {t('orva_documents.preview.sampleHint', 'กำลังแสดงข้อมูลตัวอย่าง — เลือกเอกสารจริงจากรายการเพื่อดูข้อมูลของคุณ')}
            </p>
          ) : null}

          {doc && doc.warnings.length > 0 ? (
            <div className="rounded-md border border-status-warning-border bg-status-warning-bg px-4 py-3 text-sm text-status-warning-text print:hidden">
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

          {loading ? (
            <div className="flex justify-center py-16"><Spinner /></div>
          ) : failed || !doc ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {t('orva_documents.preview.failed', 'ไม่สามารถสร้างตัวอย่างเอกสารได้')}
            </p>
          ) : (
            <div className="flex flex-col items-center gap-6">
              {/* A4 sheet: fixed width so the on-screen preview matches paper */}
              <div
                // the server-side PDF renderer waits for this marker before printing
                data-document-sheet="true"
                className="flex w-[794px] max-w-full flex-col bg-card p-10 shadow-sm print:w-full print:p-0 print:shadow-none" style={{ minHeight: A4_SHEET_MIN_HEIGHT }}
              >
                <Template doc={doc} t={t} />
              </div>
              {doc.isTaxDocument || doc.isDeliveryNote ? (
                // Thai practice prints tax documents in duplicate: ต้นฉบับ for
                // the customer, สำเนา kept by the company — the second sheet
                // starts a new page in print/PDF. A ใบส่งของ needs two for a
                // different reason: one is left with the goods and one comes
                // back signed.
                <div
                  className="flex w-[794px] max-w-full break-before-page flex-col bg-card p-10 shadow-sm print:w-full print:p-0 print:shadow-none" style={{ minHeight: A4_SHEET_MIN_HEIGHT }}
                >
                  <Template doc={{ ...doc, copyRole: 'copy' }} t={t} />
                </div>
              ) : null}
            </div>
          )}
        </div>
      </PageBody>
    </Page>
  )
}
