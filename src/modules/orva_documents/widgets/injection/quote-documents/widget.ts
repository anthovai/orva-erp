import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import QuoteDocumentsWidget from './widget.client'

/** Links from the installed quote detail screen to this quote's printable Thai documents. */
const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'orva_documents.injection.quote-documents',
    title: 'Quote documents',
    description: 'Open the Thai document preview (quotation, invoice, tax invoice, receipt) scoped to this quote.',
    priority: 30,
    enabled: true,
    features: ['orva_documents.view'],
  },
  Widget: QuoteDocumentsWidget as never,
}

export default widget
