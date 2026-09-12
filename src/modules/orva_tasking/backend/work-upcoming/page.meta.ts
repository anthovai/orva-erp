/**
 * A sibling of งาน, not a child of it.
 *
 * This page used to live at `/backend/tasking/{slug}`. `buildAdminNav` turns a
 * route into a child when another route's href is a prefix of it and the two
 * share a group, and `CollapsibleNavSection` only draws children while the
 * parent is the active route — so at the old path this entry vanished from the
 * sidebar unless you happened to be standing on งาน. A flat path is the whole
 * fix; the group and the order are unchanged.
 *
 * The breadcrumb now carries the relationship the URL used to imply.
 */
export const metadata = {
  requireAuth: true,
  requireFeatures: ['orva_tasking.view'],
  pageTitle: 'Upcoming',
  pageTitleKey: 'orva_tasking.upcoming.title',
  pageGroup: 'Projects',
  pageGroupKey: 'orva.nav.project',
  pageOrder: 20,
  icon: 'calendar-clock',
  breadcrumb: [
    { label: 'Tasks', labelKey: 'orva_tasking.page.title', href: '/backend/tasking' },
    { label: 'Upcoming', labelKey: 'orva_tasking.upcoming.title' },
  ],
} as const
