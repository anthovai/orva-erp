export const metadata = {
  requireAuth: true,
  requireFeatures: ['orva_purchasing.manage'],
  pageTitle: 'Create Purchase Order',
  pageTitleKey: 'orva_purchasing.create.page.title',
  pageGroup: 'Stock',
  pageGroupKey: 'orva.nav.stock',
  // Reached from the list, so it stays out of the sidebar.
  navHidden: true,
  breadcrumb: [
    { label: 'Purchase Orders', labelKey: 'orva_purchasing.page.title', href: '/backend/purchasing/orders' },
    { label: 'Create Purchase Order', labelKey: 'orva_purchasing.create.page.title' },
  ],
}
