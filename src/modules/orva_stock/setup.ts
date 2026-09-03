import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['orva_stock.*'],
    admin: ['orva_stock.*'],
    // Whoever minds the counter can sell and receive; posting COGS needs orva_finance.gl.post too.
    employee: ['orva_stock.view', 'orva_stock.manage'],
  },
}

export default setup
