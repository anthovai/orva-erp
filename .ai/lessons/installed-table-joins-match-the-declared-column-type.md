---
title: "Reading an installed table from raw SQL: its column types and its columns are not yours to assume"
modules: ["orva_support", "attachments", "platform"]
areas: ["debugging", "module-data"]
topics: ["raw-sql", "type-casts", "installed-tables", "soft-delete", "silent-failure", "catch-swallows-errors"]
---

# Reading an installed table from raw SQL: its column types and its columns are not yours to assume

**Context**: The support portal (I4) reads the files hanging on a ticket
straight out of the installed `attachments` table. The query was written from
the shape of *our* tables, and the database refused it twice, for two different
reasons — one of which a defensive `.catch()` had hidden.

## 1. The type is the installed module's choice, not ours

```sql
-- wrong: attachments.record_id is `text`, our ticket id is `uuid`
where record_id = ?::uuid
join orva_support_tickets t on t.id = a.record_id
```

`record_id` is a **generic** pointer that has to hold ids of every shape, so the
installed module could not have typed it `uuid`. Postgres has no `text = uuid`
operator, so the statement does not return nothing — it **errors**:

```
operator does not exist: text = uuid
```

Cast on the side you control, so the installed column is compared as itself:

```sql
where record_id = ?            -- bind String(id)
join orva_support_tickets t on t.id::text = a.record_id
```

Casting the installed column instead (`a.record_id::uuid`) throws on any row
whose value is not uuid-shaped — including other modules' rows.

## 2. Not every table has the columns ours all have

Every Orva table carries `deleted_at`, so `and deleted_at is null` goes in by
reflex. **`attachments` has no soft-delete column at all** — the installed
delete route removes the row. The reflex costs a 500 with an empty body:

```
column "deleted_at" does not exist
```

## 3. A `.catch(() => [])` on a read turns both of these into "no rows"

```ts
// how the first error stayed invisible for an afternoon
const rows = (await tem.execute(sql, params).catch(() => [])) as Row[]
```

A defensive catch on a read makes a type error, a missing column, a missing
table and a permissions failure all render as *"this ticket has no
attachments"* — a sentence indistinguishable from the truth. Do not write it.
If an optional installed module may genuinely be absent, check for it once and
say so in the response.

## How to check in seconds, without a 15-minute integration run

`information_schema` and a throwaway id answer both questions against the real
schema, read-only, writing nothing:

```js
// scripts run from the repo root so `dotenv` resolves
const nobody = randomUUID()
await client.query(`select ... from attachments where record_id = $1 ...`, [nobody])
await client.query(
  `select table_name, column_name, data_type from information_schema.columns
   where table_name = 'attachments'`)
```

Every statement a new route issues, run once with ids that match nothing: what
comes back is `0 rows` or the exact refusal. This found both faults above in
under a minute after an integration run had spent 25 minutes reporting only
`expected JSON, got: ` (empty).

**Rule**: before writing raw SQL against an installed table, read its entity
(`node_modules/@open-mercato/core/src/modules/<id>/data/entities.ts`) for the
declared `type:` of every column you touch and for whether the column exists at
all; never `.catch()` a read; and in an integration spec assert the **status**
before parsing the body, so a 500 says 500 instead of showing an empty string.

Related: [[raw-sql-array-binding-is-one-literal]] (the other raw-SQL binding
trap that also presents as an empty 500), and
[[raw-sql-on-encrypted-columns-leaks-ciphertext]] (raw SQL bypassing something
the ORM path does for you).
