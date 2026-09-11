"use client"
import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { PrintableDocument } from '../../../../lib/document'
import { templateComponentFor } from '../../../../components/templates'

type PortalQuote = { id: string; number: string; issueDate: string | null; validUntil: string | null; total: number; currency: string; billed: boolean }
type PortalInvoice = {
  id: string; number: string; issueDate: string | null; dueDate: string | null; paidDate: string | null
  total: number; outstanding: number; currency: string; quoteNumber: string | null; installmentNo: number | null
}
type PortalDocuments = {
  linked: boolean
  quotes: PortalQuote[]
  invoices: PortalInvoice[]
  summary: { outstanding: number; unpaidCount: number; currency: string }
}
type SheetResponse = { document: PrintableDocument; labels: Record<string, string>; kind: 'quote' | 'invoice' }

const money = (value: number, currency: string) =>
  `${value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`

/**
 * เอกสารของฉัน — what the customer can look up without emailing to ask.
 *
 * Their own quotations and งวด invoices, what is still outstanding, and the
 * real sheet for any of them in the seller's own template. Nothing here takes
 * an id from the URL: the server answers from the session's customer record,
 * so there is no document to guess at.
 */
export default function PortalBillingPage() {
  const t = useT()
  const [data, setData] = React.useState<PortalDocuments | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [failed, setFailed] = React.useState(false)
  const [open, setOpen] = React.useState<{ id: string; type?: string } | null>(null)
  const [sheet, setSheet] = React.useState<SheetResponse | null>(null)
  const [sheetLoading, setSheetLoading] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    fetch('/api/orva_documents/portal/documents', { credentials: 'include' })
      .then(async (res) => {
        if (cancelled) return
        if (!res.ok) { setFailed(true); return }
        setData((await res.json()) as PortalDocuments)
      })
      .catch(() => { if (!cancelled) setFailed(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  React.useEffect(() => {
    if (!open) { setSheet(null); return }
    let cancelled = false
    setSheetLoading(true)
    const qs = new URLSearchParams({ id: open.id })
    if (open.type) qs.set('type', open.type)
    fetch(`/api/orva_documents/portal/document?${qs}`, { credentials: 'include' })
      .then(async (res) => {
        if (cancelled) return
        if (!res.ok) { setSheet(null); return }
        setSheet((await res.json()) as SheetResponse)
      })
      .catch(() => { if (!cancelled) setSheet(null) })
      .finally(() => { if (!cancelled) setSheetLoading(false) })
    return () => { cancelled = true }
  }, [open])

  if (loading) return <div className="flex justify-center py-24"><Spinner /></div>

  if (failed || !data) {
    return (
      <div className="mx-auto max-w-xl px-6 py-24 text-center">
        <p className="text-sm text-muted-foreground">
          {t('orva_documents.portal.failed', 'โหลดเอกสารไม่สำเร็จ ลองใหม่อีกครั้ง')}
        </p>
      </div>
    )
  }

  // An account nobody has attached to a customer record has no documents to
  // show, and saying "you have none" would be a different and wrong statement.
  if (!data.linked) {
    return (
      <div className="mx-auto max-w-xl px-6 py-24 text-center">
        <h1 className="text-lg font-semibold">{t('orva_documents.portal.title', 'ใบเสนอราคาและใบแจ้งหนี้')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('orva_documents.portal.notLinked', 'บัญชีนี้ยังไม่ได้ผูกกับข้อมูลลูกค้า กรุณาแจ้งผู้ขายเพื่อเชื่อมให้')}
        </p>
      </div>
    )
  }

  if (open) {
    const doc = sheet?.document
    const Template = doc ? templateComponentFor(doc) : null
    // The sheet reads the document's own Thai labels, so a customer whose
    // browser asks for English still receives the document the seller issued.
    const sheetT = (key: string, fallback?: string) => sheet?.labels[key] ?? fallback ?? key
    return (
      <div className="min-h-screen bg-muted/40 py-8 print:bg-transparent print:py-0">
        <div className="mx-auto flex w-fit max-w-full flex-col gap-4 px-4 print:w-auto print:px-0">
          <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
            <Button type="button" variant="outline" onClick={() => setOpen(null)}>
              {t('orva_documents.portal.back', 'กลับไปรายการเอกสาร')}
            </Button>
            <Button type="button" variant="outline" onClick={() => window.print()} disabled={!doc}>
              {t('orva_documents.preview.print', 'พิมพ์')}
            </Button>
          </div>
          {sheetLoading ? <div className="flex justify-center py-24"><Spinner /></div> : null}
          {!sheetLoading && !doc ? (
            <p className="py-24 text-center text-sm text-muted-foreground">
              {t('orva_documents.portal.sheetFailed', 'เปิดเอกสารนี้ไม่ได้')}
            </p>
          ) : null}
          {doc && Template ? (
            <div data-document-sheet="true" className="w-[794px] max-w-full bg-card p-10 shadow-sm print:w-full print:p-0 print:shadow-none">
              <Template doc={doc} t={sheetT} />
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  const nothing = !data.quotes.length && !data.invoices.length

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-lg font-semibold">{t('orva_documents.portal.title', 'ใบเสนอราคาและใบแจ้งหนี้')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {t('orva_documents.portal.intro', 'เอกสารของคุณทั้งหมด เปิดดูหรือพิมพ์เก็บไว้ได้ทุกเมื่อ')}
      </p>

      {data.summary.unpaidCount > 0 ? (
        <div className="mt-4 rounded-lg border bg-card p-4" data-testid="portal-outstanding">
          <div className="text-sm text-muted-foreground">{t('orva_documents.portal.outstanding', 'ยอดค้างชำระ')}</div>
          <div className="text-2xl font-semibold tabular-nums">{money(data.summary.outstanding, data.summary.currency)}</div>
          <div className="text-xs text-muted-foreground">
            {t('orva_documents.portal.unpaidCount', 'ใบแจ้งหนี้ที่ยังไม่ได้ชำระ {n} ใบ').replace('{n}', String(data.summary.unpaidCount))}
          </div>
        </div>
      ) : null}

      {nothing ? (
        <p className="mt-8 text-sm text-muted-foreground">
          {t('orva_documents.portal.empty', 'ยังไม่มีเอกสาร เมื่อผู้ขายออกใบเสนอราคาหรือใบแจ้งหนี้ให้คุณ จะขึ้นที่นี่')}
        </p>
      ) : null}

      {data.invoices.length ? (
        <section className="mt-6" aria-labelledby="portal-invoices">
          <h2 id="portal-invoices" className="mb-2 text-base font-semibold">{t('orva_documents.portal.invoices', 'ใบแจ้งหนี้')}</h2>
          <ul className="divide-y rounded-lg border bg-card" data-testid="portal-invoices">
            {data.invoices.map((invoice) => (
              <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <button type="button" className="font-medium hover:underline" onClick={() => setOpen({ id: invoice.id, type: 'invoice' })}>
                    {invoice.number}
                  </button>
                  <div className="text-xs text-muted-foreground">
                    {[
                      invoice.issueDate,
                      invoice.installmentNo ? t('orva_documents.portal.installment', 'งวดที่ {n}').replace('{n}', String(invoice.installmentNo)) : null,
                      invoice.quoteNumber,
                    ].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="text-right">
                  <div className="tabular-nums">{money(invoice.total, invoice.currency)}</div>
                  <div className={`text-xs ${invoice.outstanding > 0 ? 'text-status-warning-text' : 'text-status-success-text'}`}>
                    {invoice.outstanding > 0
                      ? t('orva_documents.portal.due', 'ค้างชำระ {amount}').replace('{amount}', money(invoice.outstanding, invoice.currency))
                      : t('orva_documents.portal.paid', 'ชำระแล้ว')}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.quotes.length ? (
        <section className="mt-6" aria-labelledby="portal-quotes">
          <h2 id="portal-quotes" className="mb-2 text-base font-semibold">{t('orva_documents.portal.quotes', 'ใบเสนอราคา')}</h2>
          <ul className="divide-y rounded-lg border bg-card" data-testid="portal-quotes">
            {data.quotes.map((quote) => (
              <li key={quote.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <button type="button" className="font-medium hover:underline" onClick={() => setOpen({ id: quote.id, type: 'quotation' })}>
                    {quote.number}
                  </button>
                  <div className="text-xs text-muted-foreground">
                    {[
                      quote.issueDate,
                      quote.validUntil ? t('orva_documents.portal.validUntil', 'ยืนราคาถึง {date}').replace('{date}', quote.validUntil) : null,
                      quote.billed ? t('orva_documents.portal.billed', 'เริ่มเรียกเก็บแล้ว') : null,
                    ].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="tabular-nums">{money(quote.total, quote.currency)}</div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
