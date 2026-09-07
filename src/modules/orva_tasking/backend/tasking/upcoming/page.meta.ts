export const metadata = {
  requireAuth: true,
  requireFeatures: ['orva_tasking.view'],
  pageTitle: 'Upcoming',
  pageTitleKey: 'orva_tasking.upcoming.title',
  pageGroup: 'Projects',
  pageGroupKey: 'orva.nav.project',
  pageOrder: 2,
  icon: 'calendar-clock',
  breadcrumb: [{ label: 'Upcoming', labelKey: 'orva_tasking.upcoming.title' }],
} as const
