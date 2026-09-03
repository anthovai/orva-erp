// One-time admin correction: move the nine demo-reversal journals
// (JE-000012 … JE-000020, reversing the seeded JE-000001 … JE-000009) from
// 2026-09-03 back to 2026-08-31 so August-only statements are clean.
//
// Posted journals are frozen by the orva_gl_journal_guard trigger BY DESIGN;
// this script runs as the admin role with triggers suspended for one
// transaction. Run it yourself, once:
//
//   node scripts/redate-demo-reversals.mjs
//
// It refuses to touch anything that is not a reversal of JE-000001..009.
import 'dotenv/config'
import { Client } from 'pg'

const url = process.env.ORVA_ADMIN_DATABASE_URL
if (!url) {
  console.error('ORVA_ADMIN_DATABASE_URL is not set (admin connection required to suspend the GL guard)')
  process.exit(1)
}
const client = new Client({ connectionString: url })
await client.connect()
try {
  await client.query('begin')
  await client.query('set local session_replication_role = replica')
  const period = await client.query(
    "select id from orva_fiscal_periods where code = '2026-08' and deleted_at is null limit 1",
  )
  if (!period.rows[0]) throw new Error('fiscal period 2026-08 not found')
  const result = await client.query(
    `update orva_gl_journals r
     set journal_date = '2026-08-31', period_id = $1, updated_at = now()
     from orva_gl_journals o
     where r.reversal_of_id = o.id
       and r.journal_kind = 'reversal'
       and r.deleted_at is null
       and o.journal_no between 'JE-000001' and 'JE-000009'
       and r.journal_date = '2026-09-03'
     returning r.journal_no, o.journal_no as reverses`,
    [period.rows[0].id],
  )
  await client.query('commit')
  console.log(`re-dated ${result.rowCount} reversal journals to 2026-08-31:`)
  for (const row of result.rows) console.log(`  ${row.journal_no} (reverses ${row.reverses})`)
} catch (error) {
  await client.query('rollback').catch(() => {})
  console.error('failed, nothing changed:', error.message)
  process.exitCode = 1
} finally {
  await client.end()
}
