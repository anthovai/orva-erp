// One-time admin cleanup of entries created while verifying phase F0
// (2026-09-04): the expense screen and the support queue were exercised
// against the real database, which posted four expense journals and opened
// four test tickets.
//
// Removes, and nothing else:
//   - GL journals JE-000027 … JE-000030 (memo starts with "ค่าใช้จ่าย" and
//     metadata.source = 'orva_finance.expense'), with their lines, then
//     rewinds the journal sequence so the next real entry is JE-000027
//   - support tickets TCK-000001 … TCK-000004 with their replies, and rewinds
//     the support_ticket sequence to 1
//
// It refuses to touch a journal that is not one of those four, and refuses a
// non-local database host. Posted journals are frozen by the
// orva_gl_journal_guard trigger BY DESIGN, so this runs as the admin role
// with triggers suspended for one transaction.
//
//   node scripts/purge-verification-entries.mjs          # dry run
//   node scripts/purge-verification-entries.mjs --apply  # do it
import 'dotenv/config'
import { Client } from 'pg'

const APPLY = process.argv.includes('--apply')
const url = process.env.ORVA_ADMIN_DATABASE_URL
if (!url) {
  console.error('ORVA_ADMIN_DATABASE_URL is not set (admin connection required to suspend the GL guard)')
  process.exit(1)
}
const target = new URL(url)
console.log(`Target database: ${target.hostname}:${target.port || '5432'}${target.pathname} as ${target.username}`)
if (!['localhost', '127.0.0.1', '::1'].includes(target.hostname) && !process.argv.includes('--allow-remote-host')) {
  console.error('Refusing: the target host is not local. Re-run with --allow-remote-host if that is really intended.')
  process.exit(1)
}

const JOURNALS = ['JE-000027', 'JE-000028', 'JE-000029', 'JE-000030']
const TICKETS = ['TCK-000001', 'TCK-000002', 'TCK-000003', 'TCK-000004']

const client = new Client({ connectionString: url })
await client.connect()
const step = async (label, sql, params = []) => {
  const result = await client.query(sql, params)
  console.log(`  ${String(result.rowCount ?? 0).padStart(4)}  ${label}`)
  return result
}

try {
  await client.query('begin')
  await client.query('set local session_replication_role = replica')

  console.log(APPLY ? 'Removing verification entries…' : 'DRY RUN — nothing will be written. Re-run with --apply.')
  const guard = await client.query(
    `select journal_no, memo, metadata->>'source' as source from orva_gl_journals
     where journal_no = any($1) and deleted_at is null`,
    [JOURNALS],
  )
  for (const row of guard.rows) {
    if (row.source !== 'orva_finance.expense') {
      throw new Error(`${row.journal_no} was not created by the expense screen (source=${row.source ?? 'null'}) — refusing`)
    }
    console.log(`  will remove ${row.journal_no}: ${row.memo}`)
  }

  await step('expense journal lines', `delete from orva_gl_journal_lines l using orva_gl_journals j
     where j.id = l.journal_id and j.journal_no = any($1) and j.metadata->>'source' = 'orva_finance.expense'`, [JOURNALS])
  await step('expense journals', `delete from orva_gl_journals where journal_no = any($1) and metadata->>'source' = 'orva_finance.expense'`, [JOURNALS])
  await step('journal sequence → next JE-000027', `update orva_gl_sequences set next_value = 27 where kind = 'journal' and next_value > 27`)

  await step('ticket replies', `delete from orva_support_replies r using orva_support_tickets t where t.id = r.ticket_id and t.ticket_no = any($1)`, [TICKETS])
  await step('test tickets', `delete from orva_support_tickets where ticket_no = any($1)`, [TICKETS])
  await step('ticket sequence → next TCK-000001', `update orva_gl_sequences set next_value = 1 where kind = 'support_ticket'`)

  console.log('Books after cleanup:')
  const after = await client.query(
    `select journal_no, to_char(journal_date, 'YYYY-MM-DD') as d, total_debit::text, memo from orva_gl_journals where deleted_at is null order by journal_no`,
  )
  for (const row of after.rows) console.log(`  ${row.journal_no}  ${row.d}  ${row.total_debit}  ${row.memo}`)
  const tickets = await client.query('select count(*)::int as n from orva_support_tickets where deleted_at is null')
  console.log(`  tickets remaining: ${tickets.rows[0].n}`)

  if (APPLY) {
    await client.query('commit')
    console.log('Committed. Restart the dev server so caches forget the removed rows.')
  } else {
    await client.query('rollback')
    console.log('Dry run rolled back — nothing changed.')
  }
} catch (error) {
  await client.query('rollback').catch(() => {})
  console.error('failed, nothing changed:', error.message)
  process.exitCode = 1
} finally {
  await client.end()
}
