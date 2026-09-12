export const metadata = {
  requireAuth: true,
  requireFeatures: ['orva_purchasing.view'],
  pageTitle: 'Purchase Orders',
  pageTitleKey: 'orva_purchasing.page.title',
  pageGroup: 'Purchasing',
  pageGroupKey: 'orva.nav.purchasing',
  // Between รับสินค้าเข้าคลัง (20) and สินค้าคงเหลือ (40): you order, then you
  // receive, then you look at what you hold.
  pageOrder: 20,
  pagePriority: 30,
  icon: 'clipboard-list',
  breadcrumb: [{ label: 'Purchase Orders', labelKey: 'orva_purchasing.page.title' }],
}
