import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

/**
 * The delivery that did not turn up.
 *
 * The home screen already lists late lines, but it only speaks when the home
 * page is open. This waits with an unread badge wherever the owner is — the
 * same reasoning the overdue-invoice scan uses, and like that one it raises and
 * sends nothing: chasing a vendor is a judgement call about a relationship,
 * not a cron job.
 */
export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'orva_purchasing.line_late',
    module: 'orva_purchasing',
    titleKey: 'orva_purchasing.notifications.lineLate.title',
    bodyKey: 'orva_purchasing.notifications.lineLate.body',
    icon: 'package-x',
    severity: 'warning',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/purchasing/orders/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/purchasing/orders/{sourceEntityId}',
    // A week: the scan raises a fresh one on the cadence in lib/lateScan.ts,
    // and a stale badge about goods that arrived last Tuesday helps nobody.
    expiresAfterHours: 168,
  },
]

export default notificationTypes
