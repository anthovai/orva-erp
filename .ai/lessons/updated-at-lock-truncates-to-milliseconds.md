---
title: "An updated_at optimistic lock read as .MS and written with now() lets the FIRST write through and 409s every one after"
modules: ["orva_documents", "platform"]
areas: ["module-data", "debugging", "testing"]
topics: ["optimistic-locking", "postgres", "timestamptz", "raw-sql", "integration-tests"]
---

# An updated_at optimistic lock read as .MS and written with now() lets the FIRST write through and 409s every one after

**Context**: `orva_documents/api/delivery-facts` (Phase B2) reads the invoice's
version with

```sql
to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at
```

and writes with

```sql
update sales_invoices set metadata = ?::jsonb, updated_at = now()
 where id = ? and updated_at = ?::timestamptz
```

The first save worked. Every subsequent save on the same invoice answered 409
"Conflict — reload and retry", no matter how freshly the caller had re-read the
version. `record-payment` had shipped with the identical pattern, so a second
payment on one invoice could never be recorded either.

**Problem**: `to_char(… .MS …)` truncates to **milliseconds**; PostgreSQL
`now()` stores **microseconds**. A row whose `updated_at` was last written by
MikroORM holds a JS date, i.e. already millisecond precision, so the first
comparison matches. After one raw `updated_at = now()`, the stored value has
microseconds the caller's echoed string cannot carry, and `updated_at = ?` can
never be true again. The failure looks exactly like a genuine concurrent edit,
which is why it survived review: the 409 branch is the one everybody wants to
see working.

**Rule**: When `updated_at` is the optimistic lock and the SQL is
hand-written, make both sides the same precision:

```sql
set    updated_at = date_trunc('milliseconds', now())
where  date_trunc('milliseconds', updated_at) = ?::timestamptz
```

Truncating the comparison alone is enough to fix it; truncating the write too
keeps the value handed back to the caller exact for its next save. The
remaining risk — two writes inside the same millisecond — is smaller than the
bug it replaces.

**How it was found**: an integration spec that saved twice
(`editing one fact leaves the others alone`). A spec that saves once, or a
unit test of the merge function, passes with the bug in place. Any route with
a version echo deserves a save-twice case.

**Applies to**: every hand-written `update … where updated_at = ?` in
`src/modules/**/api/**`. Routes built on `makeCrudRoute`/commands are not
affected — they compare the entity's own loaded value.
