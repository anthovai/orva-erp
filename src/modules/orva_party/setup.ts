import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['orva_party.*'],
    admin: ['orva_party.*'],
    employee: ['orva_party.parties.view'],
  },
}

export default setup
