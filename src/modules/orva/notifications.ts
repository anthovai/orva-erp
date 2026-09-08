import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

/**
 * The enquiry that arrives while nobody is looking.
 *
 * The public lead form (phase G4) creates a deal on the first pipeline stage
 * and said nothing to anybody. For a one-person company that is the whole
 * problem: an enquiry at two in the morning sits in a pipeline the owner
 * opens on Thursday, and the person who wrote in has already asked somebody
 * else. This notification is the missing half of that feature — it waits
 * wherever the owner is in the app, with an unread badge.
 *
 * It carries no reply of its own. Answering an enquiry is a human act, and
 * the same reasoning the overdue scan uses applies here: raise it, do not
 * send anything.
 */
export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'orva.lead.received',
    module: 'orva',
    titleKey: 'orva.notifications.leadReceived.title',
    bodyKey: 'orva.notifications.leadReceived.body',
    icon: 'user-plus',
    severity: 'info',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/customers/deals/pipeline',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/customers/deals/pipeline',
    // A fortnight: past that the home screen's own list is the better place
    // to see it, and an unread badge on a three-week-old enquiry is noise.
    expiresAfterHours: 336,
  },
]

export default notificationTypes
