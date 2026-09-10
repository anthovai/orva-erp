import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

/**
 * The retainer scan raises this and issues nothing. Minting an invoice in a
 * customer's name is a decision, not a chore (spec A8), so the sweep says
 * "this retainer's cycle has come round" and the owner presses ออกใบแจ้งหนี้
 * on the register — the same one-click path, with their own session behind
 * the number series and the ledger posting.
 */
export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: 'orva_support.retainer.due',
    module: 'orva_support',
    titleKey: 'orva_support.notifications.retainerDue.title',
    bodyKey: 'orva_support.notifications.retainerDue.body',
    icon: 'receipt',
    severity: 'warning',
    actions: [
      {
        id: 'view',
        labelKey: 'common.view',
        variant: 'outline',
        href: '/backend/support/subscriptions?bucket=retainers',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/support/subscriptions?bucket=retainers',
    // A week: the next scan raises a fresh one while it is still unbilled.
    expiresAfterHours: 168,
  },
]

export default notificationTypes
