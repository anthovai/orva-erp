export const metadata = {
  requireAuth: true,
  requireFeatures: ['orva_finance.gl.manage'],
  pageTitle: 'Create journal',
  pageTitleKey: 'orva_finance.journals.form.create.title',
  navHidden: true,
  breadcrumb: [
    { label: 'GL Journals', labelKey: 'orva_finance.journals.page.title', href: '/backend/gl/journals' },
    { label: 'Create' },
  ],
}
