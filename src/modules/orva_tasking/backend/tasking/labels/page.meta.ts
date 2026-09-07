export const metadata = {
  requireAuth: true,
  requireFeatures: ['orva_tasking.view'],
  pageTitle: 'Labels',
  pageTitleKey: 'orva_tasking.labels.title',
  pageGroup: 'Projects',
  pageGroupKey: 'orva.nav.project',
  pageOrder: 4,
  icon: 'tags',
  breadcrumb: [{ label: 'Labels', labelKey: 'orva_tasking.labels.title' }],
} as const
