import 'dotenv/config'
import pg from 'pg'
import { randomUUID } from 'node:crypto'

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()
let failures = 0
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failures++ }

try {
  const { rows: [scope] } = await client.query(`select t.id as tenant, o.id as org from tenants t, organizations o limit 1`)

  // create party + role inside a tenant-scoped txn
  await client.query('begin')
  await client.query(`select set_config('orva.tenant_id', $1, true)`, [scope.tenant])
  const { rows: [party] } = await client.query(
    `insert into orva_parties (tenant_id, organization_id, kind, display_name, created_at, updated_at)
     values ($1, $2, 'company', 'RLS Probe Co', now(), now()) returning id`, [scope.tenant, scope.org])
  await client.query(
    `insert into orva_party_roles (tenant_id, organization_id, party_id, role, created_at, updated_at)
     values ($1, $2, $3, 'vendor', now(), now())`, [scope.tenant, scope.org, party.id])

  // duplicate active role -> unique violation
  let dupBlocked = false
  await client.query('savepoint s1')
  try {
    await client.query(
      `insert into orva_party_roles (tenant_id, organization_id, party_id, role, created_at, updated_at)
       values ($1, $2, $3, 'vendor', now(), now())`, [scope.tenant, scope.org, party.id])
  } catch (e) { dupBlocked = /orva_party_roles_active_unique/.test(e.message) }
  await client.query('rollback to s1')
  check('duplicate active role blocked (partial unique)', dupBlocked)

  // dangling FK -> violation
  let fkBlocked = false
  await client.query('savepoint s2')
  try {
    await client.query(
      `insert into orva_party_roles (tenant_id, organization_id, party_id, role, created_at, updated_at)
       values ($1, $2, $3, 'vendor', now(), now())`, [scope.tenant, scope.org, randomUUID()])
  } catch (e) { fkBlocked = /orva_party_roles_party_fk/.test(e.message) }
  await client.query('rollback to s2')
  check('dangling party_id blocked (real FK)', fkBlocked)

  const { rows: [{ count: inTenant }] } = await client.query(
    `select count(*)::int as count from orva_parties where id = $1`, [party.id])
  check('own tenant txn: party visible', inTenant === 1)
  await client.query('commit')

  // cross-tenant txn: invisible + unwritable
  await client.query('begin')
  await client.query(`select set_config('orva.tenant_id', $1, true)`, [randomUUID()])
  const { rows: [{ count: crossRead }] } = await client.query(
    `select count(*)::int as count from orva_parties where id = $1`, [party.id])
  const { rowCount: crossWrite } = await client.query(
    `update orva_parties set notes = 'hacked' where id = $1`, [party.id])
  await client.query('rollback')
  check('cross-tenant txn: party invisible (RLS)', crossRead === 0, `${crossRead} visible`)
  check('cross-tenant txn: party unwritable (RLS)', crossWrite === 0, `${crossWrite} updated`)

  // cleanup
  await client.query(`delete from orva_party_roles where party_id = $1`, [party.id])
  await client.query(`delete from orva_parties where id = $1`, [party.id])
} finally {
  await client.end()
}
process.exit(failures === 0 ? 0 : 1)
