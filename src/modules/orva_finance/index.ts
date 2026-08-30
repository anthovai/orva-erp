import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'orva_finance',
  title: 'Orva Finance',
  version: '0.1.0',
  description:
    'General ledger foundation: chart of accounts, fiscal periods, and double-entry journals with balance validation, period control, and database-enforced immutability of posted entries.',
  author: 'Anthovai',
  license: 'MIT',
}

export { features } from './acl'
