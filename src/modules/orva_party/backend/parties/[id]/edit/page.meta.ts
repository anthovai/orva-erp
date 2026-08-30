export const metadata = {
  requireAuth: true,
  requireFeatures: ['orva_party.parties.manage'],
  pageTitle: 'Edit party',
  pageTitleKey: 'orva_party.form.edit.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Parties', labelKey: 'orva_party.page.title', href: '/backend/parties' },
    { label: 'Edit', labelKey: 'orva_party.form.edit.title' },
  ],
}
