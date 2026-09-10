/** Reached from the filings page with an employee and a year; not a nav entry. */
export const metadata = {
  requireAuth: true,
  requireFeatures: ['orva_hr.payroll.view'],
  pageTitle: 'Withholding certificate (50 bis)',
  pageTitleKey: 'orva_hr.statutory.cert.page.title',
  pageGroup: 'HR',
  pageGroupKey: 'orva.nav.hr',
  navHidden: true,
  breadcrumb: [
    { label: 'Payroll filings', labelKey: 'orva_hr.statutory.page.title', href: '/backend/hr/statutory' },
    { label: 'Withholding certificate', labelKey: 'orva_hr.statutory.cert.page.title' },
  ],
}
