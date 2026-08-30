export const metadata = {
  requireAuth: true,
  requireFeatures: ['orva_hr.employees.manage'],
  pageTitle: 'Add employee',
  pageTitleKey: 'orva_hr.employees.form.create.title',
  navHidden: true,
  breadcrumb: [
    { label: 'Employees', labelKey: 'orva_hr.employees.page.title', href: '/backend/hr/employees' },
    { label: 'Create' },
  ],
}
