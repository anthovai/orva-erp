import type { PageMetadata } from '@open-mercato/shared/modules/registry'

/**
 * Reached from the work list, not from the nav — the nav cannot name a project
 * without knowing which ones this customer has.
 */
export const metadata: PageMetadata = {
  requireAuth: true,
  requireFeatures: ['orva_tasking.portal.view'],
  titleKey: 'orva_tasking.portal.projectTitle',
  title: 'Project',
  navHidden: true,
}

export default metadata
