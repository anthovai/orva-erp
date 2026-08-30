export const metadata = {
  requireAuth: true,
  requireFeatures: ['orva_sso.manage'],
  pageTitle: 'Edit SSO connection',
  pageTitleKey: 'orva_sso.form.edit.title',
  navHidden: true,
  breadcrumb: [
    { label: 'SSO connections', labelKey: 'orva_sso.page.title', href: '/backend/settings/sso' },
    { label: 'Edit', labelKey: 'orva_sso.form.edit.title' },
  ],
}
