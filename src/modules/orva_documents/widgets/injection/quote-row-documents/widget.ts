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
    // No `features` gate here, deliberately. The host evaluates widget
    // features against the CLIENT's granted list, and /api/auth/admin/nav
    // returns `grantedFeatures: []` for a superadmin — its access comes from
    // a server-side bypass, not from explicit grants. A metadata gate
    // therefore hides the widget from the one account that owns the tenant,
    // which is how the Review button went missing from the quote screen.
    // The page itself is behind `sales.quotes.view` and every route the
    // widget calls checks its own features server-side, so the gate here
    // bought nothing and cost the owner the button.
  },
  rowActions: [
    {
      id: 'orva_documents.quote.review',
      label: 'orva_documents.rowAction.review',
      onSelect: (row, context) => navigateToPreview(row, context, 'quotation'),
    },
    // The reusable thing in this business is the last quote, so a copy is a
    // row action rather than a blank form: same customer, same lines, a new
    // draft with its own number.
    {
      id: 'orva_documents.quote.duplicate',
      label: 'orva_documents.rowAction.duplicate',
      onSelect: (row, context) => {
        if (!row || typeof row !== 'object') return
        const id = (row as Record<string, unknown>).id
        if (typeof id !== 'string' || !id) return
        const navigate = (context as { navigate?: (href: string) => void }).navigate
        void (async () => {
          try {
            const res = await fetch('/api/orva_documents/duplicate-quote', {
              method: 'POST',
              credentials: 'include',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ quoteId: id }),
            })
            const body = (await res.json().catch(() => null)) as { id?: string; error?: string } | null
            if (!res.ok || !body?.id) {
              window.alert(body?.error ?? 'ทำใบใหม่ไม่สำเร็จ')
              return
            }
            if (typeof navigate === 'function') navigate(`/backend/sales/quotes/${encodeURIComponent(body.id)}`)
            else window.location.href = `/backend/sales/quotes/${encodeURIComponent(body.id)}`
          } catch {
            window.alert('ทำใบใหม่ไม่สำเร็จ')
          }
        })()
      },
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
