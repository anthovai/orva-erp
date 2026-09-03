export const features = [
  { id: 'orva_stock.view', title: 'View stock valuation and lot costs', module: 'orva_stock' },
  {
    id: 'orva_stock.manage',
    title: 'Receive stock from bills, record retail sales, post COGS',
    module: 'orva_stock',
    dependsOn: ['orva_stock.view'],
  },
]

export default features
