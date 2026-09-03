"use client"
import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
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
import { DOCUMENT_TEMPLATES } from '../../../components/templates'

type SourceOption = { id: string; kind?: string; number: string; issueDate: string | null; customerName: string | null }
type PreviewResponse = { document: PrintableDocument; sources: SourceOption[]; usedSample: boolean; sourceKind?: string }

const TYPE_LABELS: Record<DocumentType, { key: string; fallback: string }> = {
  quotation: { key: 'orva_documents.type.quotation', fallback: 'ใบเสนอราคา' },
  invoice: { key: 'orva_documents.type.invoice', fallback: 'ใบแจ้งหนี้' },
  tax_invoice: { key: 'orva_documents.type.tax_invoice', fallback: 'ใบกำกับภาษี / ใบแจ้งหนี้' },
  receipt: { key: 'orva_documents.type.receipt', fallback: 'ใบกำกับภาษี/ใบเสร็จรับเงิน' },
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
    apiCall<PreviewResponse>(`/api/orva_documents/preview?${params.toString()}`)
      .then((call) => {
        if (cancelled) return
        if (call.ok && call.result) setData(call.result)
        else setFailed(true)
      })
      .catch(() => { if (!cancelled) setFailed(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [type, template, sourceId])

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
  const isTaxType = type === 'tax_invoice' || type === 'receipt'
  const etaxAvailable = etaxConfigured && isTaxType && sourceId !== SAMPLE_VALUE

  const selectorParams = React.useCallback(() => {
    const params = new URLSearchParams({ type })
    if (template) params.set('template', template)
    if (sourceId !== SAMPLE_VALUE) params.set('documentId', sourceId)
    return params
  }, [type, template, sourceId])

  // Server-rendered PDF: the browser downloads the same sheet it is showing.
  const downloadPdf = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/orva_documents/pdf?${selectorParams().toString()}`, { credentials: 'include' })
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
  const copyCustomerLink = async () => {
    if (busy || sourceId === SAMPLE_VALUE) return
    setBusy(true)
    try {
      const call = await apiCall<{ url: string; validUntil: string | null }>('/api/orva_documents/share', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quoteId: sourceId }),
      })
      if (!call.ok || !call.result) {
        flash(t('orva_documents.share.failed', 'สร้างลิงก์ลูกค้าไม่สำเร็จ'), 'error')
        return
      }
      await navigator.clipboard.writeText(call.result.url).catch(() => {
        window.prompt(t('orva_documents.share.copyManually', 'คัดลอกลิงก์นี้'), call.result!.url)
      })
      flash(
        t('orva_documents.share.copied', 'คัดลอกลิงก์แล้ว — ลิงก์เดิมที่เคยส่งจะใช้ไม่ได้อีก'),
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
  const Template = DOCUMENT_TEMPLATES[(doc?.template || template || 'classic') as TemplateId].Component

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

            <Button type="button" variant="outline" onClick={() => window.print()} disabled={!doc}>
              {t('orva_documents.preview.print', 'พิมพ์')}
            </Button>
            <Button type="button" onClick={downloadPdf} disabled={!doc || busy}>
              {t('orva_documents.preview.downloadPdf', 'ดาวน์โหลด PDF')}
            </Button>
            {data?.sourceKind === 'quote' && sourceId !== SAMPLE_VALUE ? (
              <Button type="button" variant="outline" onClick={copyCustomerLink} disabled={busy}>
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
                className="w-[794px] max-w-full bg-card p-10 shadow-sm print:w-full print:p-0 print:shadow-none"
              >
                <Template doc={doc} t={t} />
              </div>
              {doc.isTaxDocument ? (
                // Thai practice prints tax documents in duplicate: ต้นฉบับ for
                // the customer, สำเนา kept by the company — the second sheet
                // starts a new page in print/PDF.
                <div
                  className="w-[794px] max-w-full break-before-page bg-card p-10 shadow-sm print:w-full print:p-0 print:shadow-none"
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
