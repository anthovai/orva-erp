export const metadata = {
  requireAuth: true,
  requireFeatures: ['orva_finance.gl.manage'],
  pageTitle: 'Edit account',
  pageTitleKey: 'orva_finance.accounts.form.edit.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Chart of Accounts', labelKey: 'orva_finance.accounts.page.title', href: '/backend/gl/accounts' },
    { label: 'Edit' },
  ],
}
