import { buildFeatureNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { notificationTypes } from '../notifications'

const logger = createLogger('orva_tasking').child({ component: 'notify' })

type Container = { resolve: <T>(name: string) => T }

/**
 * Raise one of this module's notifications, after the write has committed.
 *
 * Never throws. A notification is a courtesy on top of work that already
 * succeeded, so failing to raise one must not turn a saved task into a 500 —
 * the same reasoning as the document send log in `orva_documents`.
 */
export async function raise(
  container: Container,
  type: string,
  input: {
    tenantId: string
    organizationId: string
    taskId: string
    /** Deduplicates: the same key never notifies twice. */
    groupKey: string
    bodyVariables: Record<string, string>
    /** Who should see it, by capability rather than by name. */
    requiredFeature?: string
  },
): Promise<void> {
  try {
    const typeDef = notificationTypes.find((candidate) => candidate.type === type)
    if (!typeDef) return
    const service = resolveNotificationService(container)
    await service.createForFeature(
      buildFeatureNotificationFromType(typeDef, {
        requiredFeature: input.requiredFeature ?? 'orva_tasking.view',
        bodyVariables: input.bodyVariables,
        sourceEntityType: 'orva_tasking:task',
        sourceEntityId: input.taskId,
        linkHref: '/backend/tasking',
        groupKey: input.groupKey,
      }),
      { tenantId: input.tenantId, organizationId: input.organizationId },
    )
  } catch (error) {
    logger.warn('Could not raise a tasking notification', {
      type,
      error: error instanceof Error ? error.message : error,
    })
  }
}
