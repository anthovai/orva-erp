export const metadata = {
  requireAuth: true,
  requireFeatures: ['orva_tasking.view'],
  pageTitle: 'Tasks',
  pageTitleKey: 'orva_tasking.page.title',
  pageGroup: 'Projects',
  pageGroupKey: 'orva.nav.project',
  pageOrder: 1,
  icon: 'list-checks',
  breadcrumb: [{ label: 'Tasks', labelKey: 'orva_tasking.page.title' }],
} as const
