import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import QuoteInstallmentsWidget from './widget.client'

/** The installments issued from this quote, listed on the quote's details. */
const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'orva_documents.injection.quote-installments',
    title: 'Quote installments',
    description: 'Invoices issued from this quote, with links to their billing documents.',
    priority: 20,
    enabled: true,
    features: ['orva_documents.view'],
  },
  Widget: QuoteInstallmentsWidget as never,
}

export default widget
