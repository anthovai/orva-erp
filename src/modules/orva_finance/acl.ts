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
]

export default features
