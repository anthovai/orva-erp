import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['orva_support.*'],
    admin: ['orva_support.*'],
    employee: ['orva_support.view', 'orva_support.manage'],
  },
}

export default setup
