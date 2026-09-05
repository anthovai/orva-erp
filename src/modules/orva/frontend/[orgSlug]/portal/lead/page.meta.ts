import type { PageMetadata } from '@open-mercato/shared/modules/registry'

/**
 * Public: a visitor enquiring has no account, and the whole point is that they
 * can reach this without one. Hidden from the portal nav, which is for people
 * who have already signed in.
 */
export const metadata: PageMetadata = {
  requireAuth: false,
  titleKey: 'orva.lead.title',
  title: 'Contact us',
  navHidden: true,
}

export default metadata
