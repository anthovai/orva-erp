"use client"
import * as React from 'react'
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
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DOCUMENT_TYPES, TEMPLATE_IDS, type DocumentType, type PrintableDocument, type TemplateId } from '../../../lib/document'
import { DOCUMENT_TEMPLATES } from '../../../components/templates'

type SourceOption = { id: string; number: string; issueDate: string | null; customerName: string | null }
type PreviewResponse = { document: PrintableDocument; sources: SourceOption[]; usedSample: boolean }

const TYPE_LABELS: Record<DocumentType, { key: string; fallback: string }> = {
  quotation: { key: 'orva_documents.type.quotation', fallback: 'ใบเสนอราคา' },
  invoice: { key: 'orva_documents.type.invoice', fallback: 'ใบแจ้งหนี้' },
  tax_invoice: { key: 'orva_documents.type.tax_invoice', fallback: 'ใบกำกับภาษี' },
  receipt: { key: 'orva_documents.type.receipt', fallback: 'ใบเสร็จรับเงิน' },
}

const SAMPLE_VALUE = '__sample__'

export default function DocumentPreviewPage() {
  const t = useT()
  const [type, setType] = React.useState<DocumentType>('quotation')
  const [template, setTemplate] = React.useState<TemplateId>('classic')
  const [sourceId, setSourceId] = React.useState<string>(SAMPLE_VALUE)
  const [data, setData] = React.useState<PreviewResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailed(false)
    const params = new URLSearchParams({ type, template })
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

  const doc = data?.document ?? null
  const Template = DOCUMENT_TEMPLATES[template].Component

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
                  {DOCUMENT_TYPES.map((value) => (
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
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
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
              <Select value={sourceId} onValueChange={setSourceId}>
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

            <Button type="button" onClick={() => window.print()} disabled={!doc}>
              {t('orva_documents.preview.print', 'พิมพ์ / บันทึกเป็น PDF')}
            </Button>
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
            <div className="flex justify-center">
              {/* A4 sheet: fixed width so the on-screen preview matches paper */}
              <div className="w-[794px] max-w-full bg-card p-10 shadow-sm print:w-full print:p-0 print:shadow-none">
                <Template doc={doc} t={t} />
              </div>
            </div>
          )}
        </div>
      </PageBody>
    </Page>
  )
}
