/**
 * Purchasing splits along who signs what: reading an order, changing one,
 * receiving against it, and linking a bill to it are four different
 * responsibilities in a company with more than one person, and the same
 * person in this one.
 *
 * `receive` and `bill` are separate from `manage` because each also needs a
 * feature from another module (`orva_stock.manage` + `wms.receive_inventory`
 * to move goods, `orva_finance.ap.manage` to touch a bill), and a grant that
 * implies a second module's authority should be named, not inherited.
 *
 * No `approve` feature: the owner is the approver (spec A2), and an ungranted
 * feature only clutters the role editor until an approval step exists.
 */
export const features = [
  { id: 'orva_purchasing.view', title: 'View purchase orders', module: 'orva_purchasing' },
  {
    id: 'orva_purchasing.manage',
    title: 'Create, send, close and cancel purchase orders',
    module: 'orva_purchasing',
    dependsOn: ['orva_purchasing.view'],
  },
  {
    id: 'orva_purchasing.receive',
    title: 'Receive goods and services against a purchase order',
    module: 'orva_purchasing',
    dependsOn: ['orva_purchasing.view'],
  },
  {
    id: 'orva_purchasing.bill',
    title: 'Link a vendor bill to a purchase order',
    module: 'orva_purchasing',
    dependsOn: ['orva_purchasing.view'],
  },
]

export default features
