"use client"
import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { FileText } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DocumentReviewDialog } from '../../../components/DocumentReviewDialog'

/**
 * The Review button at the top of the quote screen — where Odoo puts Preview
 * on the quotation form and QuickBooks puts Print-or-Preview on the invoice.
 *
 * Injected into `form-header:detail`, which every detail screen renders, so
 * the path decides whether this is a quote: the spot's context carries the
 * pathname, and anything that is not `/backend/sales/quotes/<id>` renders
 * nothing. The record id is taken from the path rather than a data payload
 * because the header spot deliberately knows nothing about the record.
 */
const QUOTE_PATH = /^\/backend\/sales\/quotes\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

export default function QuoteDocumentsWidget({ context }: { context?: Record<string, unknown> }) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const path = typeof context?.path === 'string' ? context.path : ''
  const quoteId = QUOTE_PATH.exec(path)?.[1] ?? null
  if (!quoteId) return null

  return (
    <div className="flex justify-end">
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <FileText className="size-4" />
        {t('orva_documents.quoteWidget.review', 'ตรวจดูเอกสาร')}
      </Button>
      <DocumentReviewDialog documentId={quoteId} open={open} onOpenChange={setOpen} />
    </div>
  )
}
