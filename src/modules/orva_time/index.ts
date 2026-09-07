import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'orva_time',
  title: 'Orva Time',
  version: '0.1.0',
  description:
    'The seam between the work and the hours: keeps a staff timesheet project (โครงการ) in step with the tasking project (โปรเจกต์) it belongs to. Owns no domain of its own — the work stays in orva_tasking, the hours stay in staff. Spec: .ai/specs/2026-09-07-orva-time-tracking-ownership-and-project-sync.md',
  author: 'Anthovai',
  license: 'MIT',
}

export { features } from './acl'
