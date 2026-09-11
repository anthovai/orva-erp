import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import QuoteDocumentsWidget from './widget.client'

/** Review button at the top of the quote screen, opening the Thai document dialog in place. */
const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'orva_documents.injection.quote-documents',
    title: 'Quote documents',
    description: 'Top-of-page Review action on the quote: the Thai document dialog (quotation, invoice, tax invoice, receipt) scoped to the record.',
    priority: 30,
    enabled: true,
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
  Widget: QuoteDocumentsWidget as never,
}

export default widget
