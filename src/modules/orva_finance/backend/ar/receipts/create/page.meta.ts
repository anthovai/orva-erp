export const metadata = {
  requireAuth: true,
  requireFeatures: ['orva_finance.ar.manage'],
  pageTitle: 'Create customer receipt',
  pageTitleKey: 'orva_finance.receipts.form.create.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Customer Receipts', labelKey: 'orva_finance.receipts.page.title', href: '/backend/ar/receipts' },
    { label: 'Create' },
  ],
}
