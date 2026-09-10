import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveScheduleId, stableScheduleId } from '@/lib/scheduleId'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('orva_support').child({ component: 'setup' })

type SchedulerServiceLike = {
  register: (input: Record<string, unknown>) => Promise<unknown>
}

export const RETAINER_SCAN_QUEUE = 'orva_support.retainer_scan'

/** Readable key; `scheduled_jobs.id` is a uuid, so the id derives from it. */
export const retainerScanScheduleKey = (organizationId: string) => `${RETAINER_SCAN_QUEUE}:${organizationId}`
export const retainerScanScheduleId = (organizationId: string) => stableScheduleId(retainerScanScheduleKey(organizationId))

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['orva_support.*'],
    admin: ['orva_support.*'],
    employee: ['orva_support.view', 'orva_support.manage'],
  },

  /**
   * Registers the daily retainer sweep. Run for existing organizations with
   *
   *   yarn mercato seed:defaults --module orva_support
   *
   * The sweep raises a notification and issues nothing (spec A8).
   */
  async seedDefaults({ tenantId, organizationId, container }) {
    const cradle = container as { hasRegistration?: (name: string) => boolean }
    if (typeof cradle.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) return
    const scheduler = container.resolve('schedulerService') as SchedulerServiceLike
    const em = container.resolve<EntityManager>('em')
    try {
      await scheduler.register({
        id: await resolveScheduleId(em, {
          key: retainerScanScheduleKey(organizationId),
          targetQueue: RETAINER_SCAN_QUEUE,
          organizationId,
        }),
        name: 'Orva — retainer billing scan',
        description: 'Raises a notification for each maintenance retainer whose cycle is due to be invoiced. Issues nothing.',
        scopeType: 'organization',
        organizationId,
        tenantId,
        scheduleType: 'cron',
        // 06:30 Asia/Bangkok, before the morning brief reads the same register.
        scheduleValue: '30 6 * * *',
        timezone: 'Asia/Bangkok',
        targetType: 'queue',
        targetQueue: RETAINER_SCAN_QUEUE,
        targetPayload: { scope: { tenantId, organizationId } },
        sourceType: 'module',
        sourceModule: 'orva_support',
        isEnabled: true,
      })
    } catch (error) {
      logger.warn('Could not register the retainer scan', {
        error: error instanceof Error ? error.message : error,
      })
    }
  },
}

export default setup
