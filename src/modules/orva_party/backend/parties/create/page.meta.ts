export const metadata = {
  requireAuth: true,
  requireFeatures: ['orva_party.parties.manage'],
  pageTitle: 'Create party',
  pageTitleKey: 'orva_party.form.create.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Parties', labelKey: 'orva_party.page.title', href: '/backend/parties' },
    { label: 'Create', labelKey: 'orva_party.form.create.submit' },
  ],
}
