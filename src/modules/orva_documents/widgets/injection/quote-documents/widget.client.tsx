"use client"
import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { FileText } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DocumentReviewDialog } from '../../../components/DocumentReviewDialog'

/**
 * One Review action on the installed quote detail screen
 * (`sales.document.detail.quote:details`), the way the reference ERPs do it:
 * Odoo's Preview on the quotation form, QuickBooks' Print-or-Preview on the
 * invoice. The operator reviews the Thai sheet in place — type and template
 * switching, PDF download, compliance warnings — without leaving the record.
 */
export default function QuoteDocumentsWidget({ data }: { data?: Record<string, unknown> }) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const quoteId = typeof data?.id === 'string' ? data.id : null
  if (!quoteId) return null

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border p-4">
      <div className="min-w-48 flex-1">
        <p className="text-sm font-semibold">
          {t('orva_documents.quoteWidget.title', 'เอกสารจากใบเสนอราคานี้')}
        </p>
        <p className="text-xs text-muted-foreground">
          {t(
            'orva_documents.quoteWidget.hint',
            'ตรวจดูใบเสนอราคา ใบแจ้งหนี้ ใบกำกับภาษี หรือใบเสร็จจากข้อมูลใบนี้ได้ทันที',
          )}
        </p>
      </div>
      <Button type="button" onClick={() => setOpen(true)}>
        <FileText className="size-4" />
        {t('orva_documents.quoteWidget.review', 'ตรวจดูเอกสาร')}
      </Button>
      <DocumentReviewDialog documentId={quoteId} open={open} onOpenChange={setOpen} />
    </div>
  )
}
