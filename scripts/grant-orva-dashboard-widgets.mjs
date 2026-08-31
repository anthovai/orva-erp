// Orva: make the app's own dashboard widgets visible on existing tenants.
//
// Dashboard visibility is an allowlist per role (`dashboard_role_widgets`,
// seeded at tenant creation). When that list is non-empty it REPLACES the
// "everything registered" default, so a widget shipped after the tenant was
// created is filtered out until its id is added. Tenants created later start
// with no rows and see every widget, so this script only repairs history.
//
// Idempotent: a widget id already present in a row is left alone.
//
// Usage: node scripts/grant-orva-dashboard-widgets.mjs [--dry]
import 'dotenv/config'
import pg from 'pg'

const ORVA_WIDGET_IDS = ['orva_finance.dashboard.overview']
const DRY = process.argv.includes('--dry')

const connectionString = process.env.ORVA_ADMIN_DATABASE_URL || process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const client = new pg.Client({ connectionString })
await client.connect()
try {
  const { rows } = await client.query(
    'select id, role_id, widget_ids_json from dashboard_role_widgets where deleted_at is null',
  )
  let updated = 0
  for (const row of rows) {
    const current = Array.isArray(row.widget_ids_json) ? row.widget_ids_json : JSON.parse(row.widget_ids_json ?? '[]')
    const missing = ORVA_WIDGET_IDS.filter((id) => !current.includes(id))
    if (missing.length === 0) continue
    const next = [...current, ...missing]
    if (!DRY) {
      await client.query(
        'update dashboard_role_widgets set widget_ids_json = $1, updated_at = now() where id = $2',
        [JSON.stringify(next), row.id],
      )
    }
    updated++
    console.log(`${DRY ? '[dry] ' : ''}role ${row.role_id}: +${missing.join(', ')}`)
  }
  console.log(`${DRY ? '[dry] ' : ''}rows updated: ${updated} / ${rows.length}`)
} finally {
  await client.end()
}
