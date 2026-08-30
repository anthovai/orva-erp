export const metadata = {
  requireAuth: true,
  requireFeatures: ['orva_finance.ap.manage'],
  pageTitle: 'Create vendor payment',
  pageTitleKey: 'orva_finance.payments.form.create.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Vendor Payments', labelKey: 'orva_finance.payments.page.title', href: '/backend/ap/payments' },
    { label: 'Create' },
  ],
}
