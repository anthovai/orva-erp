import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

/**
 * Notifications this module raises. It raises them and sends nothing —
 * delivery is the notifications module's business, and the bell is where the
 * team already looks.
 */
export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'orva_tasking.task.reminder',
    module: 'orva_tasking',
    titleKey: 'orva_tasking.notifications.reminder.title',
    bodyKey: 'orva_tasking.notifications.reminder.body',
    icon: 'alarm-clock',
    severity: 'warning',
    linkHref: '/backend/tasking',
    actions: [
      { id: 'view', labelKey: 'common.view', variant: 'outline', href: '/backend/tasking', icon: 'external-link' },
    ],
    // A week. Past that the work is either done or the next scan has spoken,
    // and a stale nudge about a finished task helps nobody.
    expiresAfterHours: 168,
  },
  {
    type: 'orva_tasking.task.assigned',
    module: 'orva_tasking',
    titleKey: 'orva_tasking.notifications.assigned.title',
    bodyKey: 'orva_tasking.notifications.assigned.body',
    icon: 'user-check',
    severity: 'info',
    linkHref: '/backend/tasking',
    actions: [
      { id: 'view', labelKey: 'common.view', variant: 'outline', href: '/backend/tasking', icon: 'external-link' },
    ],
    expiresAfterHours: 336,
  },
  {
    type: 'orva_tasking.comment.created',
    module: 'orva_tasking',
    titleKey: 'orva_tasking.notifications.comment.title',
    bodyKey: 'orva_tasking.notifications.comment.body',
    icon: 'message-square',
    severity: 'info',
    linkHref: '/backend/tasking',
    actions: [
      { id: 'view', labelKey: 'common.view', variant: 'outline', href: '/backend/tasking', icon: 'external-link' },
    ],
    expiresAfterHours: 336,
  },
]

export default notificationTypes
