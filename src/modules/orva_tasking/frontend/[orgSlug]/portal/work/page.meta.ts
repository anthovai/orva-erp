import type { PageMetadata } from '@open-mercato/shared/modules/registry'

/**
 * Signed-in customers only. The feature gate is enforced again by every API
 * route this page calls — page metadata decides what appears in the nav, not
 * what the server will answer.
 */
export const metadata: PageMetadata = {
  requireAuth: true,
  requireFeatures: ['orva_tasking.portal.view'],
  titleKey: 'orva_tasking.portal.title',
  title: 'Our work',
}

export default metadata
