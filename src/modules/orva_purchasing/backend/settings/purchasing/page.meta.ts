export const metadata = {
  requireAuth: true,
  requireFeatures: ['orva_purchasing.manage'],
  pageTitle: 'Purchasing',
  pageTitleKey: 'orva_purchasing.settings.page.title',
  pageContext: 'settings' as const,
  navHidden: true,
  breadcrumb: [{ label: 'Purchasing', labelKey: 'orva_purchasing.settings.page.title' }],
}
