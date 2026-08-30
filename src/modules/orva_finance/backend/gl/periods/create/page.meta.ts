export const metadata = {
  requireAuth: true,
  requireFeatures: ['orva_finance.gl.manage'],
  pageTitle: 'Create fiscal period',
  pageTitleKey: 'orva_finance.periods.form.create.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Fiscal Periods', labelKey: 'orva_finance.periods.page.title', href: '/backend/gl/periods' },
    { label: 'Create' },
  ],
}
