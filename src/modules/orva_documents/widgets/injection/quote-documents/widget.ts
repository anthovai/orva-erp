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
    features: ['orva_documents.view'],
  },
  Widget: QuoteDocumentsWidget as never,
}

export default widget
