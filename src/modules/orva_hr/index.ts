import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'orva_hr',
  title: 'Orva HR',
  version: '0.1.0',
  description:
    'HR and payroll: employee records linked to staff team members, payroll runs calculated by the Rust payroll engine (Thai SSO + withholding tax), posted into the Orva GL.',
  author: 'Anthovai',
  license: 'MIT',
}

export { features } from './acl'
