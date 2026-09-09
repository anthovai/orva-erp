import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveScheduleId, stableScheduleId } from '@/lib/scheduleId'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('orva_finance').child({ component: 'setup' })

type SchedulerServiceLike = {
  register: (input: Record<string, unknown>) => Promise<unknown>
}

/** Stable per organization, so re-running setup updates rather than duplicates. */
export const OVERDUE_SCAN_QUEUE = 'orva_finance.overdue_reminder_scan'
export const DAILY_BRIEF_QUEUE = 'orva_finance.daily_brief'

/** The readable keys; `scheduled_jobs.id` is a uuid, so the ids derive from them. */
export const overdueScanScheduleKey = (organizationId: string) => `${OVERDUE_SCAN_QUEUE}:${organizationId}`
export const dailyBriefScheduleKey = (organizationId: string) => `${DAILY_BRIEF_QUEUE}:${organizationId}`

/**
 * Stable ids for the two schedules. Derived uuids — the readable key was
 * rejected by Postgres on re-registration (`invalid input syntax for type
 * uuid`), which purchasing's identical setup surfaced on 2026-09-09. The rows
 * this tenant already has carry random ids, so `seedDefaults` resolves the
 * existing row for the queue first and only falls back to these.
 */
export const overdueScanScheduleId = (organizationId: string) => stableScheduleId(overdueScanScheduleKey(organizationId))
export const dailyBriefScheduleId = (organizationId: string) => stableScheduleId(dailyBriefScheduleKey(organizationId))

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['orva_finance.*'],
    admin: ['orva_finance.*'],
    // Employees can read the ledger and bills; posting stays a deliberate grant.
    employee: ['orva_finance.gl.view', 'orva_finance.ap.view', 'orva_finance.ar.view'],
  },

  /**
   * CORRECTION (2026-09-07): this said `seedDefaults` runs at tenant creation
   * only, and pointed at a `scripts/register-overdue-scan.mjs` that does not
   * exist in the repository. Both were wrong. `mercato seed:defaults` walks
   * every existing organization and calls this hook:
   *
   *   yarn mercato seed:defaults --module orva_finance
   *
   * `defaultRoleFeatures` above is the part that genuinely does not reach an
   * existing tenant and still has to be granted by hand.
   */
  async seedDefaults({ tenantId, organizationId, container }) {
    const cradle = container as { hasRegistration?: (name: string) => boolean }
    if (typeof cradle.hasRegistration !== 'function' || !cradle.hasRegistration('schedulerService')) return
    const scheduler = container.resolve('schedulerService') as SchedulerServiceLike
    const em = container.resolve<EntityManager>('em')
    try {
      await scheduler.register({
        id: await resolveScheduleId(em, {
          key: overdueScanScheduleKey(organizationId),
          targetQueue: OVERDUE_SCAN_QUEUE,
          organizationId,
        }),
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
        targetQueue: OVERDUE_SCAN_QUEUE,
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

    try {
      await scheduler.register({
        id: await resolveScheduleId(em, {
          key: dailyBriefScheduleKey(organizationId),
          targetQueue: DAILY_BRIEF_QUEUE,
          organizationId,
        }),
        name: 'Orva — weekday morning brief',
        description: 'One notification covering filings, tickets, renewals, expiring quotes and unbilled accepted work.',
        scopeType: 'organization',
        organizationId,
        tenantId,
        scheduleType: 'cron',
        // 07:30 Asia/Bangkok, Monday to Friday — the owner has a day job.
        scheduleValue: '30 7 * * 1-5',
        timezone: 'Asia/Bangkok',
        targetType: 'queue',
        targetQueue: DAILY_BRIEF_QUEUE,
        targetPayload: { scope: { tenantId, organizationId } },
        sourceType: 'module',
        sourceModule: 'orva_finance',
        isEnabled: true,
      })
    } catch (error) {
      logger.warn('Could not register the morning brief', {
        error: error instanceof Error ? error.message : error,
      })
    }
  },
}

export default setup
