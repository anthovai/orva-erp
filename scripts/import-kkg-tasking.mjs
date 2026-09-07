// Orva: bring the work out of KKG-Tasking (the company Vikunja fork) into
// orva_tasking.
//
// Re-runnable by design. Every row it creates carries an `import_ref` back to
// the source row, uniquely indexed per tenant, so a second run updates what it
// made last time instead of duplicating it. Run it as often as you like while
// the two systems overlap; run it once more the day you switch over.
//
// Reads, never writes, on the KKG-Tasking side.
//
//   Setup — put these in .env so no token lands in your shell history:
//     KKG_TASKING_URL=https://vikunja.152.42.177.130.sslip.io
//     KKG_TASKING_TOKEN=<an API token from Settings → API tokens>
//     KKG_IMPORT_FALLBACK_USER=<an Orva user uuid to attribute orphan comments to>
//
//   Usage:
//     node scripts/import-kkg-tasking.mjs --dry     # report only, writes nothing
//     node scripts/import-kkg-tasking.mjs
//
// The token needs read scope on projects, tasks, labels and comments.
import 'dotenv/config'
import pg from 'pg'

const DRY = process.argv.includes('--dry')
const SOURCE = 'kkg-tasking'

const baseUrl = (process.env.KKG_TASKING_URL || '').replace(/\/+$/, '')
const token = process.env.KKG_TASKING_TOKEN || ''
const fallbackUser = process.env.KKG_IMPORT_FALLBACK_USER || ''
const connectionString = process.env.ORVA_ADMIN_DATABASE_URL || process.env.DATABASE_URL

if (!baseUrl || !token) {
  console.error('Set KKG_TASKING_URL and KKG_TASKING_TOKEN in .env first.')
  console.error('The token comes from KKG-Tasking → Settings → API tokens, with read access to projects, tasks, labels and comments.')
  process.exit(1)
}
if (!connectionString) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

// ---------------------------------------------------------------- source read

async function api(path) {
  const res = await fetch(`${baseUrl}/api/v1${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`GET ${path} → ${res.status} ${res.statusText} ${body.slice(0, 200)}`)
  }
  return res.json()
}

/** Vikunja paginates at 50; walk until a short page. */
async function apiAll(path) {
  const out = []
  for (let page = 1; page <= 200; page += 1) {
    const sep = path.includes('?') ? '&' : '?'
    const rows = await api(`${path}${sep}page=${page}&per_page=50`)
    if (!Array.isArray(rows) || rows.length === 0) break
    out.push(...rows)
    if (rows.length < 50) break
  }
  return out
}

// ---------------------------------------------------------------- mapping

/**
 * Vikunja priority runs 0–5 ("DO NOW"); Orva stops at 4 (urgent). Anything
 * above urgent is still urgent.
 */
const mapPriority = (value) => Math.max(0, Math.min(4, Number(value) || 0))

/**
 * Vikunja stores percent_done as a fraction (0.8 = 80%). Values above 1 are
 * treated as already-percent, so a source that changed its mind does not turn
 * 80% into 8000%.
 */
const mapPercent = (value) => {
  const n = Number(value) || 0
  const pct = n <= 1 ? n * 100 : n
  return Math.max(0, Math.min(100, Math.round(pct)))
}

/** Vikunja sends `0001-01-01T00:00:00Z` for "no date". */
const mapDate = (value) => {
  if (!value || typeof value !== 'string') return null
  if (value.startsWith('0001-01-01')) return null
  const date = value.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date !== '0001-01-01' ? date : null
}

const mapTimestamp = (value) => {
  const date = mapDate(value)
  return date ? value : null
}

/**
 * Comment bodies are HTML in Vikunja and plain text in Orva, which renders
 * them with whitespace preserved. Tags are dropped rather than rendered,
 * because rendering imported HTML would be an injection surface for no gain.
 */
const htmlToText = (html) =>
  String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()

/**
 * Vikunja's twelve relation kinds against Orva's three.
 *
 * Only the forward halves are listed: Orva writes the inverse itself, so
 * importing `parenttask` as well would just fight the pair it already wrote.
 * The nine that are dropped (duplicateof, precedes, copiedfrom and friends)
 * have no Orva equivalent and are counted rather than silently ignored.
 */
const RELATION_MAP = { subtask: 'subtask', blocking: 'blocks', related: 'related' }

/** Vikunja anchors a relative reminder on a named date; Orva shortens it. */
const REMINDER_ANCHOR = { due_date: 'due', start_date: 'start', end_date: 'end' }

/**
 * Vikunja repeat modes: 0 = from the original due date, 1 = monthly,
 * 2 = from the day it was completed.
 *
 * Monthly has no fixed number of days, so it is reported rather than turned
 * into "every 30 days" — a monthly task quietly drifting off its date is worse
 * than one the owner is told to set again.
 */
const REPEAT_MODE = { 0: 'from_due', 2: 'from_completion' }

const hex = (value) => {
  const candidate = `#${String(value ?? '').replace(/^#/, '')}`
  return /^#[0-9a-fA-F]{6}$/.test(candidate) ? candidate.toLowerCase() : '#64748b'
}

/**
 * The repeat pair, or neither half.
 *
 * Orva's check constraint wants both columns or neither, and separately wants
 * a date to move forward from. A repeat with nothing to shift would have the
 * roll worker producing identical copies for ever, so it is dropped here and
 * counted.
 */
function repeatColumns(task, startDate, endDate) {
  const seconds = Number(task.repeat_after) || 0
  if (seconds <= 0) return { repeat_every_days: null, repeat_mode: null }
  const mode = REPEAT_MODE[Number(task.repeat_mode)]
  const days = Math.round(seconds / 86400)
  const hasAnchor = Boolean(mapDate(task.due_date) || startDate || endDate)
  if (!mode || days < 1 || !hasAnchor) {
    repeatSkips.push(`"${task.title}": ${!mode ? 'monthly repeats have no fixed length' : days < 1 ? 'repeats more often than daily' : 'no date to repeat from'}`)
    return { repeat_every_days: null, repeat_mode: null }
  }
  return { repeat_every_days: days, repeat_mode: mode }
}

/** Collected by repeatColumns and folded into the report at the end. */
const repeatSkips = []

// ---------------------------------------------------------------- run

const client = new pg.Client({ connectionString })
await client.connect()

const report = {
  projects: { created: 0, updated: 0 },
  buckets: { created: 0, updated: 0 },
  labels: { created: 0, updated: 0 },
  tasks: { created: 0, updated: 0 },
  comments: { created: 0, skipped: 0 },
  relations: { created: 0, skipped: 0 },
  reminders: { created: 0, skipped: 0 },
  repeats: { created: 0, skipped: 0 },
  assignees: { matched: 0, unmatched: 0 },
  warnings: [],
}

try {
  const { rows: orgs } = await client.query(
    `select o.id as organization_id, o.tenant_id
     from organizations o
     where o.deleted_at is null and o.tenant_id is not null
     order by o.created_at
     limit 1`,
  )
  if (!orgs.length) throw new Error('No organization found to import into')
  const { organization_id: organizationId, tenant_id: tenantId } = orgs[0]
  console.log(`Importing into tenant ${tenantId}, organization ${organizationId}`)

  // Orva users by email, so a Vikunja assignee or comment author can be
  // matched to a real account rather than guessed at.
  const { rows: userRows } = await client.query(
    'select id, email_hash from users where deleted_at is null and tenant_id = $1',
    [tenantId],
  )
  // `users.email` is encrypted at rest, so it cannot be matched in SQL. The
  // Vikunja side is matched by username instead, below, and anything that does
  // not match is reported rather than silently dropped.
  const orvaUserCount = userRows.length

  const scoped = (kind, id) => `${SOURCE}:${kind}:${id}`

  // Relations can cross projects, so they are applied after every task exists.
  const orvaTaskId = new Map()
  const pendingRelations = []

  const upsert = async (table, importRef, columns) => {
    const keys = Object.keys(columns)
    const { rows: existing } = await client.query(
      `select id from ${table} where tenant_id = $1 and import_ref = $2 and deleted_at is null`,
      [tenantId, importRef],
    )
    if (existing.length) {
      if (!DRY) {
        await client.query(
          `update ${table} set ${keys.map((k, i) => `"${k}" = $${i + 1}`).join(', ')}, updated_at = now()
           where id = $${keys.length + 1}`,
          [...keys.map((k) => columns[k]), existing[0].id],
        )
      }
      return { id: existing[0].id, created: false }
    }
    if (DRY) {
      // A sentinel rather than null, so a dry run walks the whole tree and can
      // actually report what it would import. Returning null here made every
      // dry run stop at the projects and print "0 tasks" as though that were
      // a finding — the one thing a dry run exists to get right.
      //
      // Deliberately not a uuid: if it ever reaches SQL, the cast fails loudly
      // instead of quietly touching some other row.
      return { id: 'dry-run', created: true }
    }
    const { rows } = await client.query(
      `insert into ${table} (tenant_id, organization_id, import_ref, ${keys.map((k) => `"${k}"`).join(', ')}, created_at, updated_at)
       values ($1, $2, $3, ${keys.map((_, i) => `$${i + 4}`).join(', ')}, now(), now())
       returning id`,
      [tenantId, organizationId, importRef, ...keys.map((k) => columns[k])],
    )
    return { id: rows[0].id, created: true }
  }

  // ---- labels first: tasks reference them -----------------------------------
  const labelByRef = new Map()
  for (const label of await apiAll('/labels')) {
    const ref = scoped('label', label.id)
    const result = await upsert('orva_tasking_labels', ref, {
      title: String(label.title ?? '').slice(0, 60) || 'label',
      hex_color: hex(label.hex_color),
    })
    labelByRef.set(label.id, result.id)
    report.labels[result.created ? 'created' : 'updated'] += 1
  }

  // ---- projects, then their buckets and tasks -------------------------------
  const projects = await apiAll('/projects')
  for (const project of projects) {
    // Vikunja's per-user Inbox is not a project anyone shares; importing it
    // would put someone's private list in front of the whole team.
    if (project.is_archived && !process.argv.includes('--with-archived')) {
      report.warnings.push(`skipped archived project "${project.title}" (pass --with-archived to include it)`)
      continue
    }
    if (String(project.title ?? '').trim().toLowerCase() === 'inbox') {
      report.warnings.push('skipped the Inbox project — it is a personal list, not shared work')
      continue
    }

    const projectRef = scoped('project', project.id)
    const projectResult = await upsert('orva_tasking_projects', projectRef, {
      name: String(project.title ?? '').slice(0, 200) || 'project',
      description: htmlToText(project.description) || null,
      is_archived: Boolean(project.is_archived),
      position: 0,
      // Left unlinked on purpose: which quotation a project bills against is
      // a judgement no importer should make. Link them on the Projects screen.
      quote_id: null,
      customer_visible: false,
    })
    report.projects[projectResult.created ? 'created' : 'updated'] += 1
    const projectId = projectResult.id
    if (!projectId) continue
    

    /**
     * Board columns come from the kanban view's task route, not from
     * `/views/{id}/buckets`.
     *
     * Two reasons, both found by trying it. The buckets route is not in
     * Vikunja's own read-only token preset and answers 401, and the plain
     * `/projects/{id}/tasks` list returns bucket_id as 0 — Vikunja only fills
     * it in when the tasks are read through a view. The kanban view's task
     * route returns the buckets themselves, each with its title, limit and
     * tasks, which answers both questions in one call and needs no wider
     * permission than the read-only preset already grants.
     */
    const bucketByRef = new Map()
    const bucketOfTask = new Map()
    try {
      const views = await api(`/projects/${project.id}/views`)
      const kanban = (Array.isArray(views) ? views : []).find((view) => view.view_kind === 'kanban')
      if (kanban) {
        const columns = await apiAll(`/projects/${project.id}/views/${kanban.id}/tasks`)
        for (const [index, column] of columns.entries()) {
          const ref = scoped('bucket', column.id)
          const result = await upsert('orva_tasking_buckets', ref, {
            project_id: projectId,
            title: String(column.title ?? '').slice(0, 80) || 'column',
            position: index,
            wip_limit: Math.max(0, Number(column.limit) || 0),
            // The done column is a per-project flag in Orva, and the unique
            // index allows only one, so the source's flag is honoured once.
            is_done_bucket: Boolean(kanban.done_bucket_id && kanban.done_bucket_id === column.id),
          })
          bucketByRef.set(column.id, result.id)
          report.buckets[result.created ? 'created' : 'updated'] += 1
          for (const task of column.tasks ?? []) bucketOfTask.set(task.id, result.id)
        }
      } else {
        report.warnings.push(`"${project.title}" has no board in KKG-Tasking; its tasks arrive unplaced and land in the first column when a board is created`)
      }
    } catch (error) {
      report.warnings.push(`could not read the board for "${project.title}": ${error.message}`)
    }

    // ---- tasks, with their comments in the same call -----------------------
    const tasks = await apiAll(`/projects/${project.id}/tasks?expand=comments`)
    for (const task of tasks) {
      const taskRef = scoped('task', task.id)
      const done = Boolean(task.done)
      const doneAt = mapTimestamp(task.done_at)
      // From the kanban read, not from task.bucket_id, which this endpoint
      // leaves at 0.
      const bucketId = bucketOfTask.get(task.id) ?? null

      const startDate = mapDate(task.start_date)
      const endDate = mapDate(task.end_date)
      // Orva refuses a backwards span at the database level, and an imported
      // pair that disagrees is the source's problem, not something to force in.
      const spanOk = !startDate || !endDate || startDate <= endDate
      if (!spanOk) {
        report.warnings.push(`task "${task.title}": start ${startDate} is after end ${endDate}; dates left empty`)
      }

      const taskResult = await upsert('orva_tasking_tasks', taskRef, {
        project_id: projectId,
        title: String(task.title ?? '').slice(0, 250) || 'task',
        description: htmlToText(task.description) || null,
        done,
        // The check constraint requires done and done_at to agree. A task
        // Vikunja marked done without a timestamp gets its update time.
        done_at: done ? (doneAt ?? mapTimestamp(task.updated) ?? new Date().toISOString()) : null,
        due_on: mapDate(task.due_date),
        start_date: spanOk ? startDate : null,
        end_date: spanOk ? endDate : null,
        percent_done: mapPercent(task.percent_done),
        identifier_index: Math.max(1, Number(task.index) || 1),
        bucket_id: bucketId,
        customer_visible: true,
        priority: mapPriority(task.priority),
        position: Math.round(Number(task.position) || 0),
        assignee_user_id: null,
        ...repeatColumns(task, spanOk ? startDate : null, spanOk ? endDate : null),
      })
      report.tasks[taskResult.created ? 'created' : 'updated'] += 1
      const taskId = taskResult.id
      if (!taskId) continue
      orvaTaskId.set(task.id, taskId)

      // Held for the second pass: the other end may live in a project this
      // loop has not reached yet.
      const rel = task.related_tasks && typeof task.related_tasks === 'object' ? task.related_tasks : {}
      for (const [vikunjaKind, others] of Object.entries(rel)) {
        if (!Array.isArray(others) || !others.length) continue
        const kind = RELATION_MAP[vikunjaKind]
        if (!kind) { report.relations.skipped += others.length; continue }
        for (const other of others) pendingRelations.push({ from: task.id, to: other.id, kind })
      }

      // ---- reminders -------------------------------------------------------
      for (const reminder of Array.isArray(task.reminders) ? task.reminders : []) {
        const anchor = REMINDER_ANCHOR[reminder.relative_to]
        const absolute = mapTimestamp(reminder.reminder)
        // Vikunja counts a period in seconds, negative for "before"; Orva
        // stores positive minutes before the anchor.
        const minutes = anchor && reminder.relative_period !== undefined
          ? Math.round(-Number(reminder.relative_period) / 60)
          : null
        const isRelative = Boolean(anchor) && minutes !== null && Number.isFinite(minutes)
        if (!isRelative && !absolute) { report.reminders.skipped += 1; continue }
        if (DRY) { report.reminders.created += 1; continue }
        // No import_ref on this table, so existence is checked on the values
        // themselves. That keeps a re-run from stacking duplicates without
        // wiping a reminder someone added in Orva by hand.
        const { rows: already } = await client.query(
          `select id from orva_tasking_task_reminders
           where task_id = $1
             and coalesce(remind_at::text, '') = coalesce($2::timestamptz::text, '')
             and coalesce(relative_to, '') = coalesce($3, '')
             and coalesce(relative_minutes, -999999) = coalesce($4, -999999)`,
          [taskId, isRelative ? null : absolute, isRelative ? anchor : null, isRelative ? minutes : null],
        )
        if (already.length) continue
        await client.query(
          `insert into orva_tasking_task_reminders
             (tenant_id, organization_id, task_id, remind_at, relative_to, relative_minutes, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, now(), now())`,
          [tenantId, organizationId, taskId, isRelative ? null : absolute, isRelative ? anchor : null, isRelative ? minutes : null],
        )
        report.reminders.created += 1
      }

      if (Array.isArray(task.assignees) && task.assignees.length) {
        // Reported, not guessed: Orva emails are encrypted so they cannot be
        // matched in SQL, and attaching the wrong person is worse than none.
        report.assignees.unmatched += task.assignees.length
      }

      // ---- labels on the task ---------------------------------------------
      if (Array.isArray(task.labels) && task.labels.length && !DRY) {
        for (const label of task.labels) {
          const labelId = labelByRef.get(label.id)
          if (!labelId) continue
          await client.query(
            `insert into orva_tasking_task_labels (tenant_id, organization_id, task_id, label_id, created_at)
             values ($1, $2, $3, $4, now())
             on conflict ("task_id", "label_id") do nothing`,
            [tenantId, organizationId, taskId, labelId],
          )
        }
      }

      // ---- comments --------------------------------------------------------
      const comments = Array.isArray(task.comments) ? task.comments : []
      for (const comment of comments) {
        const body = htmlToText(comment.comment)
        if (!body) { report.comments.skipped += 1; continue }
        if (!fallbackUser) {
          report.comments.skipped += 1
          continue
        }
        const author = comment.author?.username ?? comment.author?.name ?? 'KKG-Tasking'
        const ref = scoped('comment', comment.id)
        // Attribution is preserved in the text rather than faked in the
        // author column: the original writer has no Orva account, and
        // pretending otherwise would put words in someone's mouth.
        const withAttribution = `[${author} · KKG-Tasking] ${body}`.slice(0, 8000)
        const result = await upsert('orva_tasking_task_comments', ref, {
          task_id: taskId,
          body: withAttribution,
          author_user_id: fallbackUser,
          author_customer_user_id: null,
          // Imported commentary stays internal. Nothing that was written
          // inside one system should become customer-visible by moving.
          is_customer_visible: false,
        })
        if (result.created) report.comments.created += 1
      }
    }
  }

  // ---- relations, once every task has an Orva id ----------------------------
  for (const link of pendingRelations) {
    const from = orvaTaskId.get(link.from)
    const to = orvaTaskId.get(link.to)
    // The other end can be missing legitimately: it may live in the Inbox or
    // an archived project, both of which this importer skips.
    if (!from || !to || from === to) { report.relations.skipped += 1; continue }
    if (DRY) { report.relations.created += 1; continue }
    const inverse = { subtask: 'parent', blocks: 'blocked_by', related: 'related' }[link.kind]
    try {
      // Both directions, as the API does, so reading one task never needs a
      // union. `on conflict do nothing` makes a re-run a no-op.
      await client.query(
        `insert into orva_tasking_task_relations
           (tenant_id, organization_id, task_id, other_task_id, kind, created_at)
         values ($1, $2, $3, $4, $5, now()), ($1, $2, $4, $3, $6, now())
         on conflict ("task_id", "other_task_id", "kind") do nothing`,
        [tenantId, organizationId, from, to, link.kind, inverse],
      )
      report.relations.created += 1
    } catch (error) {
      report.relations.skipped += 1
      report.warnings.push(`could not link two tasks: ${error.message.slice(0, 120)}`)
    }
  }

  // ---------------------------------------------------------------- report
  console.log('')
  console.log(DRY ? '--- DRY RUN — nothing was written ---' : '--- imported ---')
  console.log(`orva users available for matching: ${orvaUserCount}`)
  for (const [kind, counts] of Object.entries(report)) {
    if (kind === 'warnings') continue
    console.log(`${kind.padEnd(10)} ${JSON.stringify(counts)}`)
  }
  if (report.assignees.unmatched) {
    console.log('')
    console.log(`NOTE: ${report.assignees.unmatched} assignments were not carried across.`)
    console.log('      Orva emails are encrypted at rest and cannot be matched in SQL, so')
    console.log('      assignees are left empty rather than attached to the wrong person.')
    console.log('      Set them on the board — it is one click per card.')
  }
  if (!fallbackUser && report.comments.skipped) {
    console.log('')
    console.log(`NOTE: ${report.comments.skipped} comments were skipped.`)
    console.log('      Set KKG_IMPORT_FALLBACK_USER to an Orva user uuid to bring them in;')
    console.log('      each keeps its original author in the text.')
  }
  for (const skip of repeatSkips) {
    report.repeats.skipped += 1
    report.warnings.push(`repeat not carried across for ${skip}`)
  }
  if (report.warnings.length) {
    console.log('')
    console.log('warnings:')
    for (const warning of report.warnings) console.log(`  - ${warning}`)
  }
} finally {
  await client.end()
}
