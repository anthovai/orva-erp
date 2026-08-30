export const features = [
  { id: 'orva_finance.gl.view', title: 'View general ledger', module: 'orva_finance' },
  {
    id: 'orva_finance.gl.manage',
    title: 'Manage accounts, periods and draft journals',
    module: 'orva_finance',
    dependsOn: ['orva_finance.gl.view'],
  },
  {
    // Posting is deliberately a separate grant: in accounting practice the
    // people who prepare entries and the people who post them often differ.
    id: 'orva_finance.gl.post',
    title: 'Post journals to the ledger',
    module: 'orva_finance',
    dependsOn: ['orva_finance.gl.manage'],
  },
  { id: 'orva_finance.ap.view', title: 'View vendor bills', module: 'orva_finance' },
  {
    id: 'orva_finance.ap.manage',
    title: 'Manage vendor bills and AP settings',
    module: 'orva_finance',
    dependsOn: ['orva_finance.ap.view'],
  },
  {
    id: 'orva_finance.ap.post',
    title: 'Post vendor bills to the ledger',
    module: 'orva_finance',
    dependsOn: ['orva_finance.ap.manage'],
  },
  { id: 'orva_finance.ar.view', title: 'View AR posting', module: 'orva_finance' },
  {
    id: 'orva_finance.ar.manage',
    title: 'Manage draft receipts and AR settings',
    module: 'orva_finance',
    dependsOn: ['orva_finance.ar.view'],
  },
  {
    id: 'orva_finance.ar.post',
    title: 'Post sales invoices to the ledger',
    module: 'orva_finance',
    dependsOn: ['orva_finance.ar.view'],
  },
]

export default features
