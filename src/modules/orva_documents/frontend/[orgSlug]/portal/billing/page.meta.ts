import type { PageMetadata } from '@open-mercato/shared/modules/registry'

/**
 * The customer's own paperwork. Customer-authenticated, like the help centre
 * and the work list: the session says who they are and the server reads only
 * their documents.
 */
export const metadata: PageMetadata = {
  requireCustomerAuth: true,
  titleKey: 'orva_documents.portal.title',
  title: 'Quotes and invoices',
  nav: {
    label: 'Quotes and invoices',
    labelKey: 'orva_documents.portal.title',
    group: 'main',
    order: 20,
  },
}

export default metadata
