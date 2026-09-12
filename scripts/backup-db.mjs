// Orva: take a verified backup of the real database.
//
// This exists because the books are real. Docker Desktop reset its disk
// location twice in one week, and the only thing standing between this
// business and its accounting history was a dump somebody remembered to take
// by hand. The newest one was seven days old when this was written.
//
// Three things make a backup worth having, and this does all three:
//
//   1. It runs `pg_dump` INSIDE the postgres container. The host has no
//      postgres client tools, so a script that shells out to `pg_dump`
//      directly would fail on this machine — and a backup command that only
//      works somewhere else is not a backup command.
//   2. It VERIFIES what it wrote. `pg_restore --list` has to parse the file
//      and find a plausible number of tables; a dump that cannot be listed
//      is not a backup, it is a file. An unverified dump is worse than no
//      dump, because it buys false confidence.
//   3. It prunes. Backups nobody deletes fill the disk that holds the
//      database, which is how a backup routine causes the outage.
//
// Usage:
//   yarn db:backup                  take one, verify it, prune to the newest 14
//   yarn db:backup --keep 30        keep more
//   yarn db:backup --verify-only    just re-verify the newest file
//
// Where: $ORVA_BACKUP_DIR, else ~/orva-backups (where the existing dumps are).
import 'dotenv/config'
import { execFile } from 'node:child_process'
import { mkdir, readdir, stat, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

const KEEP_DEFAULT = 14
/** A dump of this database lists far more than this; anything less is a stub. */
const MIN_TABLES = 50
const MIN_BYTES = 256 * 1024

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const value = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const backupDir = process.env.ORVA_BACKUP_DIR || path.join(homedir(), 'orva-backups')
const keep = Math.max(1, Number(value('--keep', KEEP_DEFAULT)) || KEEP_DEFAULT)

function parseDatabaseUrl(raw) {
  if (!raw) throw new Error('DATABASE_URL is not set')
  const url = new URL(raw)
  return {
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    port: url.port || '5432',
  }
}

/** The running postgres container for this project, whatever compose named it. */
async function findContainer() {
  const { stdout } = await run('docker', ['ps', '--format', '{{.Names}}\t{{.Image}}'])
  const rows = stdout.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.split('\t'))
  const match = rows.find(([name, image]) => /postgres|pgvector/.test(image) && /postgres/.test(name))
    ?? rows.find(([, image]) => /postgres|pgvector/.test(image))
  if (!match) {
    throw new Error(
      'No running postgres container found. Start the database first (docker compose up -d postgres).',
    )
  }
  return match[0]
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')

/** Reads the dump back through pg_restore and counts what it claims to hold. */
async function verify(container, containerPath, label) {
  const { stdout } = await run('docker', ['exec', container, 'pg_restore', '--list', containerPath], {
    maxBuffer: 64 * 1024 * 1024,
  })
  const tables = (stdout.match(/^\d+;.*\bTABLE DATA\b/gm) ?? []).length
  if (tables < MIN_TABLES) {
    throw new Error(`${label}: only ${tables} tables in the dump (expected at least ${MIN_TABLES}) — refusing to call this a backup`)
  }
  return tables
}

async function newestDump() {
  const files = (await readdir(backupDir).catch(() => []))
    .filter((f) => f.endsWith('.dump'))
  const withTimes = await Promise.all(files.map(async (f) => {
    const s = await stat(path.join(backupDir, f))
    return { file: f, mtime: s.mtimeMs, size: s.size }
  }))
  return withTimes.sort((a, b) => b.mtime - a.mtime)
}

async function main() {
  const db = parseDatabaseUrl(process.env.DATABASE_URL)
  const container = await findContainer()
  await mkdir(backupDir, { recursive: true })

  if (flag('--verify-only')) {
    const [newest] = await newestDump()
    if (!newest) throw new Error(`No .dump files in ${backupDir} — nothing to verify`)
    // Copy it in so pg_restore can read it, then check and clean up.
    const inside = `/tmp/${newest.file}`
    await run('docker', ['cp', path.join(backupDir, newest.file), `${container}:${inside}`], { maxBuffer: 1024 * 1024 * 1024 })
    const tables = await verify(container, inside, newest.file)
    await run('docker', ['exec', container, 'rm', '-f', inside]).catch(() => {})
    console.log(`OK  ${newest.file} — ${tables} tables, ${(newest.size / 1024 / 1024).toFixed(1)} MB`)
    return
  }

  // Dump as the ADMIN role: a backup must include every table regardless of
  // row-level security, and the app role is deliberately not allowed to read
  // past its own tenant.
  const admin = process.env.ORVA_ADMIN_DATABASE_URL ? parseDatabaseUrl(process.env.ORVA_ADMIN_DATABASE_URL) : db
  const name = `orva_erp-${stamp()}.dump`
  const inside = `/tmp/${name}`

  console.log(`[backup] ${db.database} → ${path.join(backupDir, name)} (via ${container})`)
  await run('docker', [
    'exec', '-e', `PGPASSWORD=${admin.password}`, container,
    'pg_dump', '-U', admin.user, '-d', admin.database, '--format=custom', '--file', inside,
  ], { maxBuffer: 64 * 1024 * 1024 })

  const tables = await verify(container, inside, name)
  await run('docker', ['cp', `${container}:${inside}`, path.join(backupDir, name)], { maxBuffer: 1024 * 1024 * 1024 })
  await run('docker', ['exec', container, 'rm', '-f', inside]).catch(() => {})

  const written = await stat(path.join(backupDir, name))
  if (written.size < MIN_BYTES) {
    await unlink(path.join(backupDir, name)).catch(() => {})
    throw new Error(`${name}: only ${written.size} bytes on disk — removed rather than kept as a false backup`)
  }
  console.log(`[backup] OK — ${tables} tables, ${(written.size / 1024 / 1024).toFixed(1)} MB`)

  const dumps = await newestDump()
  const stale = dumps.slice(keep)
  for (const old of stale) {
    await unlink(path.join(backupDir, old.file))
    console.log(`[backup] pruned ${old.file}`)
  }
  console.log(`[backup] keeping ${Math.min(dumps.length, keep)} of ${dumps.length}`)
}

main().catch((error) => {
  console.error(`[backup] FAILED: ${error.message}`)
  process.exit(1)
})
