import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('orva_finance').child({ component: 'setup' })

type SchedulerServiceLike = {
  register: (input: Record<string, unknown>) => Promise<unknown>
}

/** Stable per organization, so re-running setup updates rather than duplicates. */
export const overdueScanScheduleId = (organizationId: string) =>
  `orva_finance.overdue_reminder_scan:${organizationId}`

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['orva_finance.*'],
    admin: ['orva_finance.*'],
    // Employees can read the ledger and bills; posting stays a deliberate grant.
    employee: ['orva_finance.gl.view', 'orva_finance.ap.view', 'orva_finance.ar.view'],
  },

  /**
   * NOTE: `seedDefaults` runs at tenant creation only. An organization that
   * already exists — which is every organization on a running install — will
   * never reach this, so the schedule must be registered once by hand for it
   * (`scripts/register-overdue-scan.mjs`). This is the same trap as
   * `defaultRoleFeatures`, which also has to be granted by hand after the fact.
   */
  async seedDefaults({ tenantId, organizationId, container }) {
    const cradle = container as { hasRegistration?: (name: string) => boolean }
    if (typeof cradle.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) return
    const scheduler = container.resolve('schedulerService') as SchedulerServiceLike
    try {
      await scheduler.register({
        id: overdueScanScheduleId(organizationId),
        name: 'Orva — overdue invoice reminder scan',
        description: 'Raises a notification for each overdue invoice that is due another nudge. Sends nothing.',
        scopeType: 'organization',
        organizationId,
        tenantId,
        scheduleType: 'cron',
        // 07:00 Asia/Bangkok — before the working day, after the books settle.
        scheduleValue: '0 7 * * *',
        timezone: 'Asia/Bangkok',
        targetType: 'queue',
        targetQueue: 'orva_finance.overdue_reminder_scan',
        targetPayload: { scope: { tenantId, organizationId } },
        sourceType: 'module',
        sourceModule: 'orva_finance',
        isEnabled: true,
      })
    } catch (error) {
      logger.warn('Could not register the overdue reminder scan', {
        error: error instanceof Error ? error.message : error,
      })
    }
  },
}

export default setup
