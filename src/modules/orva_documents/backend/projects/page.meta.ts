export const metadata = {
  requireAuth: true,
  requireFeatures: ['orva_documents.view'],
  pageTitle: 'Projects',
  pageTitleKey: 'orva_documents.projects.page.title',
  pageGroup: 'Projects',
  pageGroupKey: 'orva.nav.project',
  pageOrder: 5,
  icon: 'briefcase',
  breadcrumb: [{ label: 'Projects', labelKey: 'orva_documents.projects.page.title' }],
} as const
