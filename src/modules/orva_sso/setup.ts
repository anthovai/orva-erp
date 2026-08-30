import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['orva_sso.*'],
    admin: ['orva_sso.*'],
  },
}

export default setup
