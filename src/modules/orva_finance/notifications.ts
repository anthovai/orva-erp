import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

/**
 * The overdue scan raises this rather than sending anything: chasing a client
 * is the owner's call, and the message still goes out by hand (or through the
 * assistant's approval-gated reminder tool). What the scan adds over the home
 * screen's live list is that this waits for the owner wherever they are in the
 * app, with an unread badge, instead of only speaking when the home page is
 * opened.
 */
export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'orva_finance.invoice.reminder_due',
    module: 'orva_finance',
    titleKey: 'orva_finance.notifications.reminderDue.title',
    bodyKey: 'orva_finance.notifications.reminderDue.body',
    icon: 'alarm-clock',
    severity: 'warning',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/sales/invoices/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/sales/invoices/{sourceEntityId}',
    // A week: past that the next scan has already raised a fresh one, and a
    // stale nudge on a settled invoice helps nobody.
    expiresAfterHours: 168,
  },
  {
    type: 'orva_finance.daily_brief',
    module: 'orva_finance',
    titleKey: 'orva_finance.notifications.dailyBrief.title',
    bodyKey: 'orva_finance.notifications.dailyBrief.body',
    icon: 'sun',
    severity: 'info',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend',
    // Yesterday's brief is worthless once today's exists.
    expiresAfterHours: 24,
  },
]

export default notificationTypes
