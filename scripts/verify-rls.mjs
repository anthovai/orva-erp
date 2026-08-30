// Orva hardening: live verification that tenant RLS actually isolates rows.
// Connects with DATABASE_URL (must be the non-superuser orva_app role).
// Usage: node scripts/verify-rls.mjs
import 'dotenv/config'
import pg from 'pg'
import { randomUUID } from 'node:crypto'

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()

let failures = 0
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

try {
  const { rows: [who] } = await client.query(
    `select current_user, (select rolsuper from pg_roles where rolname = current_user) as is_super,
            (select rolbypassrls from pg_roles where rolname = current_user) as bypass`,
  )
  check('connected as non-superuser app role', who.current_user === 'orva_app' && !who.is_super && !who.bypass,
    `user=${who.current_user} super=${who.is_super} bypassrls=${who.bypass}`)

  const { rows: [{ count: baseline }] } = await client.query(
    `select count(*)::int as count from users where tenant_id is not null`,
  )
  check('fail-open baseline (GUC unset): tenant rows visible', baseline > 0, `${baseline} users`)

  const { rows: [tenant] } = await client.query(`select id from tenants limit 1`)

  // Wrong tenant: tenant-scoped rows must disappear.
  await client.query('begin')
  await client.query(`select set_config('orva.tenant_id', $1, true)`, [randomUUID()])
  const { rows: [{ count: wrongRead }] } = await client.query(
    `select count(*)::int as count from users where tenant_id is not null`,
  )
  const { rowCount: wrongWrite } = await client.query(
    `update users set updated_at = updated_at where tenant_id is not null`,
  )
  await client.query('rollback')
  check('wrong tenant GUC: tenant rows invisible', wrongRead === 0, `${wrongRead} visible`)
  check('wrong tenant GUC: tenant rows unwritable', wrongWrite === 0, `${wrongWrite} updated`)

  // Right tenant: that tenant's rows stay visible.
  await client.query('begin')
  await client.query(`select set_config('orva.tenant_id', $1, true)`, [tenant.id])
  const { rows: [{ count: rightRead }] } = await client.query(
    `select count(*)::int as count from users where tenant_id = $1`, [tenant.id],
  )
  await client.query('rollback')
  check('right tenant GUC: own rows visible', rightRead > 0, `${rightRead} users`)

  // GUC is transaction-local: nothing leaks to the session afterwards.
  const { rows: [{ leak }] } = await client.query(
    `select nullif(current_setting('orva.tenant_id', true), '') as leak`,
  )
  check('GUC does not leak past the transaction', leak === null, `leaked=${leak}`)

  const { rows: [{ count: policyCount }] } = await client.query(
    `select count(*)::int as count from pg_policies where policyname = 'orva_tenant_isolation'`,
  )
  check('policies installed on tenant tables', policyCount > 200, `${policyCount} tables`)
} finally {
  await client.end()
}

process.exit(failures === 0 ? 0 : 1)
