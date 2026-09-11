import type { PageMetadata } from '@open-mercato/shared/modules/registry'

/**
 * The customer's own tickets, next to the help centre — same customer session,
 * same rule that the server answers from the session rather than from an id in
 * the URL.
 */
export const metadata: PageMetadata = {
  requireCustomerAuth: true,
  titleKey: 'orva_support.portal.tickets.title',
  title: 'My tickets',
  nav: {
    label: 'My tickets',
    labelKey: 'orva_support.portal.tickets.title',
    group: 'main',
    order: 30,
  },
}

export default metadata
