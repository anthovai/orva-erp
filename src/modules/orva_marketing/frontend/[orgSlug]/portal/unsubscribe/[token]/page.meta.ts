import type { PageMetadata } from '@open-mercato/shared/modules/registry'

/**
 * Public: the reader arrives from a link in an email and has no account. The
 * token in the path is the whole credential. Hidden from the portal nav.
 */
export const metadata: PageMetadata = {
  requireAuth: false,
  titleKey: 'orva_marketing.unsubscribe.title',
  title: 'Unsubscribe',
  navHidden: true,
}

export default metadata
