// Orva hardening: create the non-superuser application role and hand it
// ownership of the app schema objects, so PostgreSQL RLS actually applies.
//
// Why: a superuser connection bypasses RLS entirely, and the default dev
// setup connects as `postgres`. This script creates `orva_app`
// (LOGIN, NOSUPERUSER, NOBYPASSRLS, CREATEDB) and transfers ownership of all
// public tables/sequences to it. Because the tables carry
// FORCE ROW LEVEL SECURITY (see the orva module migration), the owner is
// still subject to the policies — so one role can run both migrations and
// the app runtime.
//
// Usage (admin connection required, e.g. the postgres superuser):
//   ORVA_APP_DB_PASSWORD=<secret> node scripts/setup-rls-role.mjs [admin-database-url]
// Defaults: admin url = ORVA_ADMIN_DATABASE_URL || DATABASE_URL (from .env)
//
// Afterwards point DATABASE_URL at orva_app, e.g.:
//   postgres://orva_app:<secret>@localhost:5432/orva_erp
//
// Caveat: `yarn db:greenfield` recreates the database; CREATE EXTENSION
// (pgvector) needs a superuser, so greenfield runs still need the admin URL.

import 'dotenv/config'
import pg from 'pg'

const adminUrl = process.argv[2] || process.env.ORVA_ADMIN_DATABASE_URL || process.env.DATABASE_URL
const password = process.env.ORVA_APP_DB_PASSWORD
if (!adminUrl) {
  console.error('No admin database URL (arg, ORVA_ADMIN_DATABASE_URL, or DATABASE_URL)')
  process.exit(1)
}
if (!password || password.length < 16) {
  console.error('Set ORVA_APP_DB_PASSWORD (min 16 chars) before running.')
  process.exit(1)
}

const client = new pg.Client({ connectionString: adminUrl })
await client.connect()
const dbName = client.database

try {
  const { rows: roleRows } = await client.query(`select 1 from pg_roles where rolname = 'orva_app'`)
  if (roleRows.length === 0) {
    // Identifier and literal are fixed strings except the password, which pg
    // cannot parameterize in DDL — escape single quotes defensively.
    const escaped = password.replace(/'/g, "''")
    await client.query(`create role orva_app login password '${escaped}' nosuperuser nocreatedb nocreaterole nobypassrls`)
    console.log('Created role orva_app')
  } else {
    const escaped = password.replace(/'/g, "''")
    await client.query(`alter role orva_app with login password '${escaped}' nosuperuser nobypassrls`)
    console.log('Role orva_app already existed — password/attributes refreshed')
  }
  // CREATEDB keeps `yarn db:greenfield` (drop/recreate) working in dev.
  await client.query(`alter role orva_app createdb`)

  await client.query(`grant connect, temporary on database "${dbName}" to orva_app`)
  await client.query(`grant usage, create on schema public to orva_app`)

  const { rows: tables } = await client.query(
    `select tablename from pg_tables where schemaname = 'public'`,
  )
  for (const { tablename } of tables) {
    await client.query(`alter table public."${tablename}" owner to orva_app`)
  }
  const { rows: sequences } = await client.query(
    `select sequencename from pg_sequences where schemaname = 'public'`,
  )
  for (const { sequencename } of sequences) {
    await client.query(`alter sequence public."${sequencename}" owner to orva_app`)
  }
  const { rows: functions } = await client.query(
    `select p.oid::regprocedure as sig from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'`,
  )
  for (const { sig } of functions) {
    await client.query(`alter function ${sig} owner to orva_app`)
  }
  await client.query(`alter database "${dbName}" owner to orva_app`)

  console.log(`Ownership of ${tables.length} tables, ${sequences.length} sequences, ${functions.length} functions and database "${dbName}" transferred to orva_app.`)
  console.log('Now set DATABASE_URL to connect as orva_app and restart the app.')
} finally {
  await client.end()
}
