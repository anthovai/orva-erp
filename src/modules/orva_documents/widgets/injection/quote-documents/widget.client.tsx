"use client"
import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@open-mercato/ui/primitives/button'
import { FileText, ReceiptText } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DocumentReviewDialog } from '../../../components/DocumentReviewDialog'
import { IssueInvoiceDialog } from '../../../components/IssueInvoiceDialog'

/**
 * The quote's document actions, top of the screen: review the quotation
 * sheet, or issue the next งวด as a REAL invoice record. Billing documents
 * no longer print from the quote directly — one bill, two record types, and
 * the invoice side starts here (the user's correction after first real use).
 *
 * Injected into `form-header:detail`, which fires on every detail header;
 * the path decides whether this is a quote. `?issueInvoice=1` opens the
 * issue dialog immediately (how the list row action arrives).
 */
const QUOTE_PATH = /^\/backend\/sales\/quotes\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

export default function QuoteDocumentsWidget({ context }: { context?: Record<string, unknown> }) {
  const t = useT()
  const searchParams = useSearchParams()
  const [reviewOpen, setReviewOpen] = React.useState(false)
  const [issueOpen, setIssueOpen] = React.useState(() => searchParams.get('issueInvoice') === '1')
  const path = typeof context?.path === 'string' ? context.path : ''
  const quoteId = QUOTE_PATH.exec(path)?.[1] ?? null
  if (!quoteId) return null

  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" onClick={() => setReviewOpen(true)}>
        <FileText className="size-4" />
        {t('orva_documents.quoteWidget.review', 'ตรวจดูเอกสาร')}
      </Button>
      <Button type="button" onClick={() => setIssueOpen(true)}>
        <ReceiptText className="size-4" />
        {t('orva_documents.issue.title', 'ออกใบแจ้งหนี้งวด')}
      </Button>
      <DocumentReviewDialog documentId={quoteId} open={reviewOpen} onOpenChange={setReviewOpen} />
      <IssueInvoiceDialog quoteId={quoteId} open={issueOpen} onOpenChange={setIssueOpen} />
    </div>
  )
}
