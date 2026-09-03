export const metadata = {
  requireAuth: true,
  requireFeatures: ['sales.invoices.manage'],
  pageTitle: 'Invoices',
  pageTitleKey: 'orva_documents.invoices.page.title',
  pageGroup: 'Sales',
  pageGroupKey: 'orva.nav.sales',
  pageOrder: 110,
  icon: 'receipt',
  breadcrumb: [{ label: 'Invoices', labelKey: 'orva_documents.invoices.page.title' }],
} as const
