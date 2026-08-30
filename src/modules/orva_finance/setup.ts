import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['orva_finance.*'],
    admin: ['orva_finance.*'],
    // Employees can read the ledger and bills; posting stays a deliberate grant.
    employee: ['orva_finance.gl.view', 'orva_finance.ap.view', 'orva_finance.ar.view'],
  },
}

export default setup
