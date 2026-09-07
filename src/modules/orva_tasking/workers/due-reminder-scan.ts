import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { buildFeatureNotificationFromType } from '@open-mercato/core/modules/notifications/lib/notificationBuilder'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { withTenantRls } from '@/lib/rls'
import { notificationTypes } from '../notifications'
import { remindersDueNow, type ReminderRow, type ReminderTask } from '../lib/reminders'

/**
 * Raises a notification for every reminder whose moment has arrived.
 *
 * Idempotent twice over: `last_fired_at` is stamped as the notification is
 * raised, and the notification's own group key is the reminder id. A re-run, a
 * retry, or two ticks of the schedule cannot nag twice about the same thing.
 */
const logger = createLogger('orva_tasking').child({ component: 'due-reminder-scan' })

export const metadata: WorkerMeta = {
  queue: 'orva_tasking.due_reminder_scan',
  id: 'orva_tasking:due-reminder-scan',
  concurrency: 1,
}

type ScanPayload = {
  scope?: { tenantId?: string; organizationId?: string }
  /** Override for tests and for `mercato scheduler run`; defaults to now. */
  now?: string
}

type HandlerContext = JobContext & {
  container?: { resolve: <T>(name: string) => T }
  resolve: <T>(name: string) => T
}

type Row = {
  id: string
  task_id: string
  remind_at: string | null
  relative_to: 'due' | 'start' | 'end' | null
  relative_minutes: number | null
  last_fired_at: string | null
  title: string
  due_on: string | null
  start_date: string | null
  end_date: string | null
  done: boolean
  assignee_user_id: string | null
  project_name: string
}

export default async function handle(job: QueuedJob<ScanPayload>, ctx: HandlerContext): Promise<void> {
  const tenantId = job.payload?.scope?.tenantId
  const organizationId = job.payload?.scope?.organizationId
  if (!tenantId || !organizationId) {
    logger.warn('Reminder scan skipped: the schedule carries no tenant scope')
    return
  }
  const now = job.payload?.now ? new Date(job.payload.now) : new Date()
  const em = ctx.resolve<EntityManager>('em')
  const container = ctx.container ?? { resolve: ctx.resolve }

  const rows = await withTenantRls(em, tenantId, async (tem) => (await tem.execute(
    `select r.id::text, r.task_id::text, r.remind_at::text, r.relative_to, r.relative_minutes,
            r.last_fired_at::text,
            t.title, to_char(t.due_on, 'YYYY-MM-DD') as due_on,
            to_char(t.start_date, 'YYYY-MM-DD') as start_date,
            to_char(t.end_date, 'YYYY-MM-DD') as end_date,
            t.done, t.assignee_user_id::text, p.name as project_name
     from orva_tasking_task_reminders r
     join orva_tasking_tasks t on t.id = r.task_id and t.deleted_at is null
     join orva_tasking_projects p on p.id = t.project_id and p.deleted_at is null
     where r.tenant_id = ?::uuid and r.organization_id = ?::uuid
       and r.last_fired_at is null and not t.done`,
    [tenantId, organizationId],
  )) as Row[])

  const tasks = new Map<string, ReminderTask>()
  const reminders: ReminderRow[] = []
  for (const row of rows) {
    tasks.set(row.task_id, {
      id: row.task_id, dueOn: row.due_on, startDate: row.start_date, endDate: row.end_date, done: row.done,
    })
    reminders.push({
      id: row.id, taskId: row.task_id, remindAt: row.remind_at,
      relativeTo: row.relative_to, relativeMinutes: row.relative_minutes,
      lastFiredAt: row.last_fired_at,
    })
  }

  const due = remindersDueNow(reminders, tasks, now)
  if (!due.length) {
    logger.info('Reminder scan found nothing due', { tenantId, now: now.toISOString() })
    return
  }

  const typeDef = notificationTypes.find((type) => type.type === 'orva_tasking.task.reminder')
  if (!typeDef) return
  const notificationService = resolveNotificationService(container)
  const byId = new Map(rows.map((row) => [row.id, row]))

  let raised = 0
  for (const reminder of due) {
    const row = byId.get(reminder.id)
    if (!row) continue
    try {
      await notificationService.createForFeature(
        buildFeatureNotificationFromType(typeDef, {
          // Whoever plans the work, rather than one named user: an assignee
          // may not be set, and the reminder still needs to reach someone.
          requiredFeature: 'orva_tasking.view',
          bodyVariables: {
            title: row.title,
            project: row.project_name,
            due: row.due_on ?? '',
          },
          sourceEntityType: 'orva_tasking:task',
          sourceEntityId: row.task_id,
          linkHref: '/backend/tasking',
          groupKey: `orva_tasking.reminder:${reminder.id}`,
        }),
        { tenantId, organizationId },
      )
      // Stamped only after the notification is raised, so a failure here means
      // the next run tries again rather than losing the reminder silently.
      await withTenantRls(em, tenantId, async (tem) => {
        await tem.execute(
          'update orva_tasking_task_reminders set last_fired_at = ?, updated_at = now() where id = ?::uuid',
          [now, reminder.id],
        )
      })
      raised += 1
    } catch (error) {
      logger.warn('Could not raise a task reminder', {
        reminderId: reminder.id,
        error: error instanceof Error ? error.message : error,
      })
    }
  }
  logger.info('Reminder scan finished', { tenantId, due: due.length, raised })
}
