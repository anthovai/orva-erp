import type { InjectionRowActionWidget } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Follow-on documents straight from the quote row, the FlowAccount pattern:
 * their quotation list opens "สร้างเอกสารใหม่ตามลำดับ" from the row itself,
 * with the data carried over. Here each action lands on the document preview
 * already scoped to the row's record — the operator picks a quote from the
 * list and issues the next document in the sequence without opening the
 * record first.
 *
 * Ordered by the Thai paper trail: ใบเสนอราคา → ใบแจ้งหนี้ →
 * ใบกำกับภาษี/ใบเสร็จรับเงิน (combined form on payment).
 */
function navigateToPreview(row: unknown, context: unknown, type: string) {
  if (!row || typeof row !== 'object') return
  const id = (row as Record<string, unknown>).id
  if (typeof id !== 'string' || id.length === 0) return
  const navigate = (context as { navigate?: (href: string) => void }).navigate
  if (typeof navigate !== 'function') return
  navigate(`/backend/documents/preview?type=${type}&documentId=${encodeURIComponent(id)}`)
}

const widget: InjectionRowActionWidget = {
  metadata: {
    id: 'orva_documents.injection.quote-row-documents',
    requiredModules: ['sales'],
    priority: 30,
    features: ['orva_documents.view'],
  },
  rowActions: [
    {
      id: 'orva_documents.quote.review',
      label: 'orva_documents.rowAction.review',
      onSelect: (row, context) => navigateToPreview(row, context, 'quotation'),
    },
    // billing documents come from an ISSUED invoice, not from printing the
    // quote — this opens the quote with the issue dialog already up
    {
      id: 'orva_documents.quote.issueInvoice',
      label: 'orva_documents.issue.title',
      onSelect: (row, context) => {
        if (!row || typeof row !== 'object') return
        const id = (row as Record<string, unknown>).id
        if (typeof id !== 'string' || !id) return
        const navigate = (context as { navigate?: (href: string) => void }).navigate
        if (typeof navigate === 'function') navigate(`/backend/sales/quotes/${encodeURIComponent(id)}?issueInvoice=1`)
      },
    },
  ],
}

export default widget
