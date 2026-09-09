import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveScheduleId, stableScheduleId } from '@/lib/scheduleId'

const logger = createLogger('orva_purchasing').child({ component: 'setup' })

type SchedulerServiceLike = {
  register: (input: Record<string, unknown>) => Promise<unknown>
}

export const LATE_SCAN_QUEUE = 'orva_purchasing.late_scan'

/** The readable key; `scheduled_jobs.id` is a uuid, so the id derives from it. */
export const lateScanScheduleKey = (organizationId: string) => `${LATE_SCAN_QUEUE}:${organizationId}`

/**
 * Stable per organization, so re-running setup updates rather than duplicates.
 *
 * A uuid derived from the key — the scheduler upserts by `id` and its column
 * is a uuid, so the readable key itself was rejected by Postgres and this scan
 * was never registered on the real tenant (seed log, 2026-09-09).
 */
export const lateScanScheduleId = (organizationId: string) => stableScheduleId(lateScanScheduleKey(organizationId))

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['orva_purchasing.*'],
    admin: ['orva_purchasing.*'],
    // Whoever orders may also receive; linking a bill additionally needs
    // orva_finance.ap.view, which accounting holds.
    employee: ['orva_purchasing.view', 'orva_purchasing.manage', 'orva_purchasing.receive'],
  },

  /**
   * Reaches existing organizations through
   * `yarn mercato seed:defaults --module orva_purchasing`.
   *
   * `defaultRoleFeatures` above is the part that does NOT reach a tenant that
   * already exists and still has to be granted by hand — the same correction
   * recorded in `orva_finance/setup.ts`.
   */
  async seedDefaults({ tenantId, organizationId, container }) {
    const cradle = container as { hasRegistration?: (name: string) => boolean }
    if (typeof cradle.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) return
    const scheduler = container.resolve('schedulerService') as SchedulerServiceLike
    const em = container.resolve<EntityManager>('em')
    try {
      await scheduler.register({
        id: await resolveScheduleId(em, {
          key: lateScanScheduleKey(organizationId),
          targetQueue: LATE_SCAN_QUEUE,
          organizationId,
        }),
        name: 'Orva — late delivery scan',
        description:
          'Raises a notification for each ordered line past its expected date that has not fully arrived. Contacts nobody.',
        scopeType: 'organization',
        organizationId,
        tenantId,
        scheduleType: 'cron',
        // 06:30 Asia/Bangkok — ahead of the invoice scan at 07:00 and the
        // morning brief at 07:30, so the brief can already see what it raised.
        scheduleValue: '30 6 * * *',
        timezone: 'Asia/Bangkok',
        targetType: 'queue',
        targetQueue: LATE_SCAN_QUEUE,
        targetPayload: { scope: { tenantId, organizationId } },
        sourceType: 'module',
        sourceModule: 'orva_purchasing',
        isEnabled: true,
      })
    } catch (error) {
      logger.warn('Could not register the late delivery scan', {
        error: error instanceof Error ? error.message : error,
      })
    }
  },
}

export default setup
