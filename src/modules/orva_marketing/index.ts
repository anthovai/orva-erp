import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'orva_marketing',
  title: 'Orva Marketing',
  version: '0.1.0',
  description:
    'Owner-run marketing for a small Thai company: marketing consent per contact (PDPA), a public unsubscribe link, and news broadcasts sent as one email per consented contact through the installed messages module, with a send log.',
  author: 'Anthovai',
  license: 'MIT',
}

export { features } from './acl'
