import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'orva_tasking',
  title: 'Orva Tasking',
  version: '0.1.0',
  description:
    'KKG-Tasking (the company Vikunja fork) as part of Orva: navigation into the task app served at /tasks, and the seam that will put work progress beside billing progress on a project.',
  author: 'Anthovai',
  license: 'MIT',
}

export { features } from './acl'
