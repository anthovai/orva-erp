import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'orva_party',
  title: 'Orva Party',
  version: '0.1.0',
  description:
    'Neutral party registry (person/company) with roles (customer, vendor, employee, contact) and links to framework records. The shared identity foundation for Orva Finance and HR.',
  author: 'Anthovai',
  license: 'MIT',
}

export { features } from './acl'
