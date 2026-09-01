import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  // Top of the quote screen, beside the header — where the reference ERPs
  // put Preview. The spot fires on every detail header; the widget renders
  // only when the path is a quote.
  'form-header:detail': [
    {
      widgetId: 'orva_documents.injection.quote-documents',
      priority: 30,
    },
  ],
  // The งวด already issued from this quote, on the quote's details surface —
  // billing documents live on invoice records, so the quote must show the
  // way to them.
  'sales.document.detail.quote:details': [
    {
      widgetId: 'orva_documents.injection.quote-installments',
      priority: 20,
    },
  ],
  // FlowAccount-style follow-on documents on the quote list row: each entry
  // opens the preview already scoped to that record.
  'data-table:sales.quotes:row-actions': [
    {
      widgetId: 'orva_documents.injection.quote-row-documents',
      priority: 30,
    },
  ],
}

export default injectionTable
