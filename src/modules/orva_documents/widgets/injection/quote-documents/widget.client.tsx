"use client"
import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@open-mercato/ui/primitives/button'
import { FileText, ListChecks, ReceiptText } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
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
  const [seeding, setSeeding] = React.useState(false)
  const [project, setProject] = React.useState<{ id: string; name: string } | null>(null)
  const [issueOpen, setIssueOpen] = React.useState(() => searchParams.get('issueInvoice') === '1')
  const path = typeof context?.path === 'string' ? context.path : ''
  const quoteId = QUOTE_PATH.exec(path)?.[1] ?? null

  // The project this quotation is the work for, if somebody linked one. The
  // button only exists when it does: tasks have to land somewhere, and
  // guessing a project from a customer name would be worse than not offering.
  React.useEffect(() => {
    if (!quoteId) return
    let cancelled = false
    apiCall<{ items?: Array<{ id: string; name: string; quoteId?: string | null }> }>('/api/orva_tasking/projects')
      .then((call) => {
        if (cancelled || !call.ok) return
        const match = (call.result?.items ?? []).find((row) => row.quoteId === quoteId)
        setProject(match ? { id: match.id, name: match.name } : null)
      })
      .catch(() => { /* the buttons that do not need a project still work */ })
    return () => { cancelled = true }
  }, [quoteId])

  const seedTasks = async () => {
    if (!project || seeding) return
    setSeeding(true)
    try {
      const call = await apiCall<{ ok: true; added: number; skipped: number; total: number }>(
        '/api/orva_tasking/projects/tasks-from-quote',
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: project.id }) },
      )
      if (!call.ok || !call.result) throw new Error((call.result as { error?: string } | undefined)?.error ?? 'failed')
      const { added, skipped } = call.result
      flash(
        added === 0
          ? t('orva_documents.seedTasks.none', 'ทุกรายการมีงานอยู่แล้วใน {project}').replace('{project}', project.name)
          : t('orva_documents.seedTasks.done', 'เพิ่ม {added} งานเข้า {project} แล้ว (ข้าม {skipped} ที่มีอยู่แล้ว)')
              .replace('{added}', String(added)).replace('{project}', project.name).replace('{skipped}', String(skipped)),
        added === 0 ? 'info' : 'success',
      )
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setSeeding(false)
    }
  }

  if (!quoteId) return null

  return (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" onClick={() => setReviewOpen(true)}>
        <FileText className="size-4" />
        {t('orva_documents.quoteWidget.review', 'ตรวจดูเอกสาร')}
      </Button>
      {project ? (
        <Button type="button" variant="outline" disabled={seeding} onClick={seedTasks}>
          <ListChecks className="size-4" />
          {t('orva_documents.seedTasks.action', 'สร้างงานจากรายการ')}
        </Button>
      ) : null}
      <Button type="button" onClick={() => setIssueOpen(true)}>
        <ReceiptText className="size-4" />
        {t('orva_documents.issue.title', 'ออกใบแจ้งหนี้งวด')}
      </Button>
      <DocumentReviewDialog documentId={quoteId} open={reviewOpen} onOpenChange={setReviewOpen} />
      <IssueInvoiceDialog quoteId={quoteId} open={issueOpen} onOpenChange={setIssueOpen} />
    </div>
  )
}
