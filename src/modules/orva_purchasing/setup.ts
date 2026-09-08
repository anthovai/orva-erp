import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['orva_purchasing.*'],
    admin: ['orva_purchasing.*'],
    // Whoever orders may also receive; linking a bill additionally needs
    // orva_finance.ap.manage, which accounting holds.
    employee: ['orva_purchasing.view', 'orva_purchasing.manage', 'orva_purchasing.receive'],
  },
}

export default setup
