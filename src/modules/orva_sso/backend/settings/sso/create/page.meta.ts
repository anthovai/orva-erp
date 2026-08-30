export const metadata = {
  requireAuth: true,
  requireFeatures: ['orva_sso.manage'],
  pageTitle: 'Add SSO connection',
  pageTitleKey: 'orva_sso.form.create.title',
  navHidden: true,
  breadcrumb: [
    { label: 'SSO connections', labelKey: 'orva_sso.page.title', href: '/backend/settings/sso' },
    { label: 'Add', labelKey: 'orva_sso.actions.create' },
  ],
}
