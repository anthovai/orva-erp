export const features = [
  { id: 'orva_hr.employees.view', title: 'View employees', module: 'orva_hr' },
  {
    id: 'orva_hr.employees.manage',
    title: 'Manage employees',
    module: 'orva_hr',
    dependsOn: ['orva_hr.employees.view'],
  },
  { id: 'orva_hr.payroll.view', title: 'View payroll runs', module: 'orva_hr' },
  {
    id: 'orva_hr.payroll.manage',
    title: 'Manage and calculate payroll runs',
    module: 'orva_hr',
    dependsOn: ['orva_hr.payroll.view'],
  },
  {
    id: 'orva_hr.payroll.post',
    title: 'Post payroll runs to the ledger',
    module: 'orva_hr',
    dependsOn: ['orva_hr.payroll.manage'],
  },
]

export default features
