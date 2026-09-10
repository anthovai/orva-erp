import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['orva_marketing.*'],
    admin: ['orva_marketing.*'],
    employee: ['orva_marketing.view'],
  },
}

export default setup
