// Orva: register the two orva_tasking schedules on an organization that
// already exists.
//
// `setup.ts seedDefaults` runs at tenant creation only, so every organization
// on a running install — which is all of them — never reaches it. This is the
// same trap that `register-overdue-scan` covered for orva_finance.
//
// Idempotent: a schedule with the same target queue and scope is updated in
// place rather than duplicated, so running this twice is harmless.
//
// Usage: node scripts/register-tasking-jobs.mjs [--dry]
import 'dotenv/config'
import pg from 'pg'

const DRY = process.argv.includes('--dry')

const JOBS = [
  {
    queue: 'orva_tasking.due_reminder_scan',
    name: 'Orva — task reminder scan',
    description: 'Raises a notification for each task reminder whose moment has arrived. Sends nothing.',
    // Every 30 minutes: a reminder set for "an hour before" should not wait
    // until tomorrow morning to speak.
    schedule: '*/30 * * * *',
  },
  {
    queue: 'orva_tasking.repeat_task_roll',
    name: 'Orva — roll repeating tasks forward',
    description: 'Creates the next occurrence of each completed repeating task. The completed one stays completed.',
    // Before the working day, and before the reminder scan, so a task that
    // came back overnight can already remind.
    schedule: '45 6 * * *',
  },
]

const connectionString = process.env.ORVA_ADMIN_DATABASE_URL || process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const client = new pg.Client({ connectionString })
await client.connect()
try {
  const { rows: orgs } = await client.query(
    `select o.id as organization_id, o.tenant_id
     from organizations o
     where o.deleted_at is null and o.tenant_id is not null
     order by o.created_at`,
  )
  if (!orgs.length) {
    console.log('No organizations found — nothing to register.')
    process.exit(0)
  }

  for (const org of orgs) {
    for (const job of JOBS) {
      const { rows: existing } = await client.query(
        `select id from scheduled_jobs
         where target_queue = $1 and organization_id = $2 and deleted_at is null`,
        [job.queue, org.organization_id],
      )
      const payload = JSON.stringify({
        scope: { tenantId: org.tenant_id, organizationId: org.organization_id },
      })

      if (existing.length) {
        console.log(`${DRY ? '[dry] ' : ''}update ${job.queue} for org ${org.organization_id}`)
        if (!DRY) {
          await client.query(
            `update scheduled_jobs
             set name = $1, description = $2, schedule_type = 'cron', schedule_value = $3,
                 timezone = 'Asia/Bangkok', target_type = 'queue', target_payload = $4::jsonb,
                 source_type = 'module', source_module = 'orva_tasking',
                 is_enabled = true, updated_at = now()
             where id = $5`,
            [job.name, job.description, job.schedule, payload, existing[0].id],
          )
        }
        continue
      }

      console.log(`${DRY ? '[dry] ' : ''}create ${job.queue} for org ${org.organization_id}`)
      if (!DRY) {
        await client.query(
          `insert into scheduled_jobs
             (organization_id, tenant_id, scope_type, name, description,
              schedule_type, schedule_value, timezone,
              target_type, target_queue, target_payload,
              source_type, source_module, is_enabled, created_at, updated_at)
           values ($1, $2, 'organization', $3, $4,
                   'cron', $5, 'Asia/Bangkok',
                   'queue', $6, $7::jsonb,
                   'module', 'orva_tasking', true, now(), now())`,
          [org.organization_id, org.tenant_id, job.name, job.description, job.schedule, job.queue, payload],
        )
      }
    }
  }
  console.log(DRY ? 'Dry run: nothing was written.' : 'Done.')
} finally {
  await client.end()
}
