import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['orva_documents.*'],
    admin: ['orva_documents.*'],
    employee: ['orva_documents.view'],
  },
}

export default setup
