import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['orva_tasking.*'],
    admin: ['orva_tasking.*'],
    // Staff can plan the work but not decide what a customer sees.
    employee: ['orva_tasking.view', 'orva_tasking.manage'],
  },
  defaultCustomerRoleFeatures: {
    portal_admin: ['orva_tasking.portal.view', 'orva_tasking.portal.comment'],
    buyer: ['orva_tasking.portal.view', 'orva_tasking.portal.comment'],
    // A viewer reads progress and does not join the conversation.
    viewer: ['orva_tasking.portal.view'],
  },
}

export default setup
