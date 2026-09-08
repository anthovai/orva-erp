import { buildFeatureNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { notificationTypes } from '../notifications'

const logger = createLogger('orva').child({ component: 'notify' })

type Container = { resolve: <T>(name: string) => T }

/**
 * Raise one of this module's notifications, after the write has committed.
 *
 * Never throws. The lead is already saved by the time this runs, and a public
 * form must not answer 500 to a prospective customer because an internal
 * notification could not be written — they would simply believe the enquiry
 * failed and go elsewhere. Same reasoning as `orva_tasking/lib/notify.ts`.
 *
 * Addressed by capability (`customers.deals.view`) rather than by name, so
 * whoever handles the pipeline sees it without this module knowing who that
 * is.
 */
export async function raise(
  container: Container,
  type: string,
  input: {
    tenantId: string
    organizationId: string
    /** The deal the enquiry became; the notification links to it. */
    dealId: string | null
    /** Deduplicates: the same key never notifies twice. */
    groupKey: string
    bodyVariables: Record<string, string>
    requiredFeature?: string
  },
): Promise<void> {
  try {
    const typeDef = notificationTypes.find((candidate) => candidate.type === type)
    if (!typeDef) return
    const service = resolveNotificationService(container)
    await service.createForFeature(
      buildFeatureNotificationFromType(typeDef, {
        requiredFeature: input.requiredFeature ?? 'customers.deals.view',
        bodyVariables: input.bodyVariables,
        sourceEntityType: 'customers:customer_deal',
        sourceEntityId: input.dealId ?? undefined,
        linkHref: '/backend/customers/deals/pipeline',
        groupKey: input.groupKey,
      }),
      { tenantId: input.tenantId, organizationId: input.organizationId },
    )
  } catch (error) {
    logger.warn('Could not raise an orva notification', {
      type,
      error: error instanceof Error ? error.message : error,
    })
  }
}
