export const metadata = {
  requireAuth: true,
  requireFeatures: ['orva_hr.payroll.view'],
  pageTitle: 'Payroll run',
  pageTitleKey: 'orva_hr.payroll.detail.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Payroll Runs', labelKey: 'orva_hr.payroll.page.title', href: '/backend/hr/payroll' },
    { label: 'Detail' },
  ],
}
