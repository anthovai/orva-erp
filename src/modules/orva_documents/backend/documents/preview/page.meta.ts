export const metadata = {
  requireAuth: true,
  requireFeatures: ['orva_documents.view'],
  pageTitle: 'Document preview',
  pageTitleKey: 'orva_documents.preview.page.title',
  pageGroup: 'Sales',
  pageGroupKey: 'orva.nav.sales',
  // Reached from the quote (top Review button, row actions), never browsed to:
  // a menu entry would reintroduce the find-the-record-again flow.
  navHidden: true,
  pageOrder: 200,
  icon: 'file-text',
  breadcrumb: [{ label: 'Document preview', labelKey: 'orva_documents.preview.page.title' }],
}
