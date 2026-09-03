import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'orva_stock',
  title: 'Orva Stock (Marventine)',
  version: '0.1.0',
  description:
    'Product-line layer on top of WMS lots: cost per lot from the OEM bill, receive-into-stock, retail sale with stock issue, on-hand valuation and monthly COGS posting to the ledger.',
  author: 'Anthovai',
  license: 'MIT',
}

export { features } from './acl'
