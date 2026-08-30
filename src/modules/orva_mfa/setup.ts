import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['orva_mfa.*'],
    admin: ['orva_mfa.*'],
    employee: ['orva_mfa.self'],
  },
}

export default setup
