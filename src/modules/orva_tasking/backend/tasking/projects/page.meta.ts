export const metadata = {
  requireAuth: true,
  requireFeatures: ['orva_tasking.view'],
  pageTitle: 'Projects',
  pageTitleKey: 'orva_tasking.projectList.title',
  pageGroup: 'Projects',
  pageGroupKey: 'orva.nav.project',
  pageOrder: 3,
  icon: 'folder-kanban',
  breadcrumb: [{ label: 'Projects', labelKey: 'orva_tasking.projectList.title' }],
} as const
