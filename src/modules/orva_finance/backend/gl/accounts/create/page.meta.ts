export const metadata = {
  requireAuth: true,
  requireFeatures: ['orva_finance.gl.manage'],
  pageTitle: 'Create account',
  pageTitleKey: 'orva_finance.accounts.form.create.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Chart of Accounts', labelKey: 'orva_finance.accounts.page.title', href: '/backend/gl/accounts' },
    { label: 'Create' },
  ],
}
