import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'orva_support',
  title: 'Orva Support',
  version: '0.1.0',
  description:
    'Customer support for shipped software: tickets against customer companies with type, priority, status, due date, replies and time spent, feeding the home screen and (later) billable hours.',
  author: 'Anthovai',
  license: 'MIT',
}

export { features } from './acl'
