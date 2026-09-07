import type { EntityManager } from '@mikro-orm/postgresql'
import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { withTenantRls } from '@/lib/rls'
import { nextOccurrence, type RepeatTask } from '../lib/reminders'

/**
 * Rolls a completed repeating task forward into its next occurrence.
 *
 * The completed one stays completed — history is not rewritten, and "we did
 * this in September" must stay true. A successor is a new row that points back
 * at its source.
 *
 * Idempotent by the database rather than by hope: `(repeat_source_id,
 * repeat_occurrence)` is uniquely indexed, so a second run, a retry, or a task
 * ticked and un-ticked twice all produce exactly one successor.
 */
const logger = createLogger('orva_tasking').child({ component: 'repeat-task-roll' })

export const metadata: WorkerMeta = {
  queue: 'orva_tasking.repeat_task_roll',
  id: 'orva_tasking:repeat-task-roll',
  concurrency: 1,
}

type RollPayload = {
  scope?: { tenantId?: string; organizationId?: string }
}

type HandlerContext = JobContext & {
  container?: { resolve: <T>(name: string) => T }
  resolve: <T>(name: string) => T
}

type Row = {
  id: string
  project_id: string
  title: string
  description: string | null
  due_on: string | null
  start_date: string | null
  end_date: string | null
  repeat_every_days: number
  repeat_mode: 'from_due' | 'from_completion'
  done_on: string | null
  priority: number
  assignee_user_id: string | null
  bucket_id: string | null
  customer_visible: boolean
  created_by: string | null
}

export default async function handle(job: QueuedJob<RollPayload>, ctx: HandlerContext): Promise<void> {
  const tenantId = job.payload?.scope?.tenantId
  const organizationId = job.payload?.scope?.organizationId
  if (!tenantId || !organizationId) {
    logger.warn('Repeat roll skipped: the schedule carries no tenant scope')
    return
  }
  const em = ctx.resolve<EntityManager>('em')

  const created = await withTenantRls(em, tenantId, async (tem) => {
    // Completed repeating tasks that have not yet been rolled. The NOT EXISTS
    // is the cheap path; the unique index is the guarantee.
    const rows = (await tem.execute(
      `select t.id::text, t.project_id::text, t.title, t.description,
              to_char(t.due_on, 'YYYY-MM-DD') as due_on,
              to_char(t.start_date, 'YYYY-MM-DD') as start_date,
              to_char(t.end_date, 'YYYY-MM-DD') as end_date,
              t.repeat_every_days, t.repeat_mode,
              to_char(t.done_at, 'YYYY-MM-DD') as done_on,
              t.priority, t.assignee_user_id::text, t.bucket_id::text,
              t.customer_visible, t.created_by::text
       from orva_tasking_tasks t
       where t.deleted_at is null and t.tenant_id = ?::uuid and t.organization_id = ?::uuid
         and t.done and t.repeat_every_days is not null
         and not exists (
           select 1 from orva_tasking_tasks s
           where s.repeat_source_id = t.id and s.deleted_at is null
         )`,
      [tenantId, organizationId],
    )) as Row[]

    let made = 0
    for (const row of rows) {
      const next = nextOccurrence({
        id: row.id,
        dueOn: row.due_on,
        startDate: row.start_date,
        endDate: row.end_date,
        repeatEveryDays: row.repeat_every_days,
        repeatMode: row.repeat_mode,
        doneOn: row.done_on,
      } satisfies RepeatTask)
      if (!next) {
        logger.warn('A repeating task carries no date to move forward', { taskId: row.id })
        continue
      }

      try {
        // The successor's number comes from the same per-project counter, and
        // the insert carries the source pair the unique index guards.
        await tem.execute(
          `insert into orva_tasking_tasks
             (tenant_id, organization_id, project_id, title, description,
              done, done_at, due_on, start_date, end_date, percent_done,
              identifier_index, bucket_id, customer_visible,
              repeat_every_days, repeat_mode, repeat_source_id, repeat_occurrence,
              priority, position, assignee_user_id, created_by, created_at, updated_at)
           select ?::uuid, ?::uuid, ?::uuid, ?, ?,
                  false, null, ?::date, ?::date, ?::date, 0,
                  coalesce(max(identifier_index), 0) + 1, ?::uuid, ?::boolean,
                  ?::int, ?, ?::uuid, ?::date,
                  ?::int, 0, ?::uuid, ?::uuid, now(), now()
           from orva_tasking_tasks where project_id = ?::uuid`,
          [
            tenantId, organizationId, row.project_id, row.title, row.description,
            next.dueOn, next.startDate, next.endDate,
            row.bucket_id, row.customer_visible,
            row.repeat_every_days, row.repeat_mode, row.id, next.occurrence,
            row.priority, row.assignee_user_id, row.created_by,
            row.project_id,
          ],
        )
        made += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // The unique index doing its job — another run got there first.
        if (/orva_tasking_tasks_repeat_occurrence_unique/.test(message)) continue
        logger.warn('Could not roll a repeating task forward', { taskId: row.id, error: message })
      }
    }
    return made
  })

  logger.info('Repeat roll finished', { tenantId, created })
}
