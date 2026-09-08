// Syntax-checks a hand-written migration WITHOUT applying it.
//
// Every `addSql` statement of the `up()` half runs inside one transaction that
// is always rolled back, and the migration is never recorded in the migrations
// table — so nothing persists, and a broken plpgsql body or a mistyped
// constraint is found here instead of at the next `db:migrate`, which in this
// app is whenever the dev server boots.
//
// This exists because every @orva/* migration is hand-written (AGENTS.md asks
// before applying one), so "review the SQL" is otherwise review by eye.
//
//   node --env-file=.env scripts/dryrun-migration.mjs //     src/modules/<id>/migrations/Migration<...>.ts
//
// Needs ORVA_ADMIN_DATABASE_URL (CREATE EXTENSION / ownership operations) and
// leaves the database exactly as it found it.
import { readFileSync } from 'node:fs'
import pg from 'pg'

const file = process.argv[2]
const url = process.env.ORVA_ADMIN_DATABASE_URL || process.env.DATABASE_URL
if (!file || !url) {
  console.error('usage: node dryrun-migration.mjs <migration.ts>  (needs ORVA_ADMIN_DATABASE_URL)')
  process.exit(2)
}

const source = readFileSync(file, 'utf8')
// Only the up() half: everything before `async down(`.
const up = source.split(/async\s+down\s*\(/)[0]
const statements = []
const re = /this\.addSql\(\s*(?:`([\s\S]*?)`|'([\s\S]*?)')\s*\)/g
let match
while ((match = re.exec(up)) !== null) statements.push((match[1] ?? match[2]).trim())

if (statements.length === 0) {
  console.error('no addSql statements found — check the parser')
  process.exit(2)
}
console.log(`parsed ${statements.length} statements from ${file}`)

const client = new pg.Client({ connectionString: url })
await client.connect()
let failed = null
try {
  await client.query('begin')
  for (const [index, sql] of statements.entries()) {
    try {
      await client.query(sql)
      console.log(`  ok  [${index + 1}/${statements.length}] ${sql.split('\n')[0].slice(0, 88)}`)
    } catch (error) {
      failed = { index: index + 1, sql, error }
      break
    }
  }
} finally {
  await client.query('rollback')
  await client.end()
}

if (failed) {
  console.error(`\nFAILED at statement ${failed.index}: ${failed.error.message}`)
  console.error(failed.sql)
  process.exit(1)
}
console.log('\nALL STATEMENTS VALID — transaction rolled back, database unchanged')
