import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'orva_tasking',
  title: 'Orva Tasking',
  version: '0.1.0',
  description:
    'Work planned and tracked in Orva itself: projects, tasks, dates, labels, comments and files, linked to the quotation the work bills against.',
  author: 'Anthovai',
  license: 'MIT',
}

export { features } from './acl'
