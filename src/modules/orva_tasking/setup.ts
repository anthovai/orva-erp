import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['orva_tasking.*'],
    admin: ['orva_tasking.*'],
    employee: ['orva_tasking.view'],
  },
}

export default setup
