export const metadata = {
  requireAuth: true,
  requireFeatures: ['orva_purchasing.view'],
  pageTitle: 'Purchase Order',
  pageTitleKey: 'orva_purchasing.detail.title',
  pageGroup: 'Stock',
  pageGroupKey: 'orva.nav.stock',
  navHidden: true,
  breadcrumb: [
    { label: 'Purchase Orders', labelKey: 'orva_purchasing.page.title', href: '/backend/purchasing/orders' },
    { label: 'Purchase Order', labelKey: 'orva_purchasing.detail.title' },
  ],
}
