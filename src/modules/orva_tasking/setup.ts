import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('orva_tasking').child({ component: 'setup' })

type SchedulerServiceLike = {
  register: (input: Record<string, unknown>) => Promise<unknown>
}

/** Stable per organization, so re-running setup updates rather than duplicates. */
export const reminderScanScheduleId = (organizationId: string) =>
  `orva_tasking.due_reminder_scan:${organizationId}`

export const repeatRollScheduleId = (organizationId: string) =>
  `orva_tasking.repeat_task_roll:${organizationId}`

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['orva_tasking.*'],
    admin: ['orva_tasking.*'],
    // Staff can plan the work but not decide what a customer sees.
    employee: ['orva_tasking.view', 'orva_tasking.manage'],
  },
  defaultCustomerRoleFeatures: {
    portal_admin: ['orva_tasking.portal.view', 'orva_tasking.portal.comment'],
    buyer: ['orva_tasking.portal.view', 'orva_tasking.portal.comment'],
    // A viewer reads progress and does not join the conversation.
    viewer: ['orva_tasking.portal.view'],
  },

  /**
   * NOTE: `seedDefaults` runs at tenant creation only. An organization that
   * already exists — which is every organization on a running install — never
   * reaches this, so the two schedules must be registered once by hand for it:
   * `node scripts/register-tasking-jobs.mjs`. The same trap applies to
   * `defaultRoleFeatures` and `defaultCustomerRoleFeatures` above, which also
   * have to be granted after the fact.
   */
  async seedDefaults({ tenantId, organizationId, container }) {
    const cradle = container as { hasRegistration?: (name: string) => boolean }
    if (typeof cradle.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) return
    const scheduler = container.resolve('schedulerService') as SchedulerServiceLike

    try {
      await scheduler.register({
        id: reminderScanScheduleId(organizationId),
        name: 'Orva — task reminder scan',
        description: 'Raises a notification for each task reminder whose moment has arrived. Sends nothing.',
        scopeType: 'organization',
        organizationId,
        tenantId,
        scheduleType: 'cron',
        // Every 30 minutes: a reminder set for "an hour before" should not
        // wait until tomorrow morning to speak.
        scheduleValue: '*/30 * * * *',
        timezone: 'Asia/Bangkok',
        targetType: 'queue',
        targetQueue: 'orva_tasking.due_reminder_scan',
        targetPayload: { scope: { tenantId, organizationId } },
        sourceType: 'module',
        sourceModule: 'orva_tasking',
        isEnabled: true,
      })
    } catch (error) {
      logger.warn('Could not register the task reminder scan', {
        error: error instanceof Error ? error.message : error,
      })
    }

    try {
      await scheduler.register({
        id: repeatRollScheduleId(organizationId),
        name: 'Orva — roll repeating tasks forward',
        description: 'Creates the next occurrence of each completed repeating task. The completed one stays completed.',
        scopeType: 'organization',
        organizationId,
        tenantId,
        scheduleType: 'cron',
        // 06:45 Asia/Bangkok — before the reminder scan and before the day
        // starts, so a task that came back overnight can already remind.
        scheduleValue: '45 6 * * *',
        timezone: 'Asia/Bangkok',
        targetType: 'queue',
        targetQueue: 'orva_tasking.repeat_task_roll',
        targetPayload: { scope: { tenantId, organizationId } },
        sourceType: 'module',
        sourceModule: 'orva_tasking',
        isEnabled: true,
      })
    } catch (error) {
      logger.warn('Could not register the repeating-task roll', {
        error: error instanceof Error ? error.message : error,
      })
    }
  },
}

export default setup
