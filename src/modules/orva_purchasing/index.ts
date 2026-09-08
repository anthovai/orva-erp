import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'orva_purchasing',
  title: 'Orva Purchasing',
  version: '0.1.0',
  description:
    'ใบสั่งซื้อ: the commitment to buy, which neither the ledger (a liability) nor the warehouse (a quantity) owns. Orders with goods and service lines, a lifecycle that freezes on send, and the links to the bills finance raises and the receipts stock records.',
  author: 'Anthovai',
  license: 'MIT',
}

export { features } from './acl'
