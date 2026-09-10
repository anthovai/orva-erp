import type { PageMetadata } from '@open-mercato/shared/modules/registry'

/**
 * The customer portal's own sign-in, not staff auth — the same gate the
 * dashboard and profile pages use. The API checks the session again; page
 * metadata decides what appears in the nav, not what the server answers.
 */
export const metadata: PageMetadata = {
  requireCustomerAuth: true,
  titleKey: 'orva_support.portal.title',
  title: 'Help centre',
  nav: { label: 'Help centre', labelKey: 'orva_support.portal.title', group: 'main', order: 40 },
}

export default metadata
