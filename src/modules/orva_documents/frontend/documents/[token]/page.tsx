"use client"
import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { PrintableDocument } from '../../../lib/document'
import { DOCUMENT_TEMPLATES } from '../../../components/templates'

type PublicDocumentResponse = {
  document: PrintableDocument
  /** Thai sheet labels, pinned by the server — see the public route. */
  labels: Record<string, string>
  isExpired: boolean
}

/**
 * What the customer sees when they open the link from their email: the actual
 * ใบเสนอราคา, in the tenant's chosen template, printable and downloadable.
 * Before this, the link led to a figures summary with nothing to file.
 *
 * No app chrome — this page is opened by someone who has no account here.
 */
export default function PublicDocumentPage({ params }: { params: { token: string } }) {
  const t = useT()
  const token = params?.token
  const [data, setData] = React.useState<PublicDocumentResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    if (!token) return
    let cancelled = false
    setLoading(true)
    fetch(`/api/orva_documents/public/${token}`)
      .then(async (res) => {
        if (cancelled) return
        if (!res.ok) { setFailed(true); return }
        setData((await res.json()) as PublicDocumentResponse)
      })
      .catch(() => { if (!cancelled) setFailed(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [token])

  if (loading) {
    return <div className="flex justify-center py-24"><Spinner /></div>
  }

  if (failed || !data) {
    return (
      <div className="mx-auto max-w-xl px-6 py-24 text-center">
        <p className="text-sm text-muted-foreground">
          {t('orva_documents.public.notFound', 'ไม่พบเอกสารนี้ — ลิงก์อาจหมดอายุหรือถูกยกเลิกแล้ว')}
        </p>
      </div>
    )
  }

  const doc = data.document
  const Template = DOCUMENT_TEMPLATES[doc.template].Component
  // The sheet reads from the document's own labels so a customer whose browser
  // asks for English still receives the Thai document the seller issued. The
  // buttons around it stay in the visitor's language.
  const sheetT = (key: string, fallback?: string) => data.labels[key] ?? fallback ?? key

  return (
    <div className="min-h-screen bg-muted/40 py-8 print:bg-transparent print:py-0">
      <div className="mx-auto flex w-fit max-w-full flex-col gap-4 px-4 print:w-auto print:px-0">
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <div className="text-sm text-muted-foreground">
            {data.isExpired
              ? t('orva_documents.public.expired', 'เอกสารนี้เลยกำหนดยืนราคาแล้ว กรุณาติดต่อผู้ขาย')
              : t('orva_documents.public.intro', 'เอกสารจากผู้ขาย — พิมพ์หรือบันทึกเก็บไว้ได้')}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => window.print()}>
              {t('orva_documents.preview.print', 'พิมพ์')}
            </Button>
            <Button asChild>
              <a href={`/api/orva_documents/public/${token}/pdf`}>
                {t('orva_documents.preview.downloadPdf', 'ดาวน์โหลด PDF')}
              </a>
            </Button>
          </div>
        </div>

        {/* A4 sheet: same marker the server-side renderer waits for */}
        <div
          data-document-sheet="true"
          className="w-[794px] max-w-full bg-card p-10 shadow-sm print:w-full print:p-0 print:shadow-none"
        >
          <Template doc={doc} t={sheetT} />
        </div>
      </div>
    </div>
  )
}
