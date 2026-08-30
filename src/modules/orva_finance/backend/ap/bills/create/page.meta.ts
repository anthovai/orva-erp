export const metadata = {
  requireAuth: true,
  requireFeatures: ['orva_finance.ap.manage'],
  pageTitle: 'Create vendor bill',
  pageTitleKey: 'orva_finance.ap.form.create.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Vendor Bills', labelKey: 'orva_finance.ap.page.title', href: '/backend/ap/bills' },
    { label: 'Create' },
  ],
}
