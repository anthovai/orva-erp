import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  // The details surface of the installed quote screen: the operator reaches
  // the printable Thai documents from the quote itself, never by re-finding
  // the record on a separate screen.
  'sales.document.detail.quote:details': [
    {
      widgetId: 'orva_documents.injection.quote-documents',
      priority: 30,
    },
  ],
}

export default injectionTable
