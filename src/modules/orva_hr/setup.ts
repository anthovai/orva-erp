import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['orva_hr.*'],
    admin: ['orva_hr.*'],
    employee: ['orva_hr.employees.view'],
  },
}

export default setup
