---
title: "A list bound to raw SQL is ONE Postgres array literal, never a JavaScript array"
modules: ["orva_stock", "orva_marketing", "orva_tasking", "orva_documents", "orva_finance", "orva_support"]
areas: ["debugging", "module-data"]
topics: ["raw-sql", "mikro-orm", "array-binding", "malformed-array-literal", "empty-500"]
---

# A list bound to raw SQL is ONE Postgres array literal, never a JavaScript array

**Context**: 2026-09-10, the marketplace-import preview returned an empty 500 in the
ephemeral suite (production build). The same trap had bitten the tasking board's card
move earlier (`orva_tasking/lib/sql.ts` documents it), but nothing indexed it.

## Symptom

`em.execute(sql, [tenantId, ['a', 'b']])` against `... = any(?::text[])`. The query
builder expands the array binding into a comma-separated list of bindings — right for
`in (?)`, wrong for `?::text[]` — so Postgres receives the first element as a bare
string and answers `malformed array literal`. In a production build an uncaught throw
becomes a **500 with an empty body**, so the assertion message
`expect(status, await text())` prints nothing useful.

## Root cause

Two conventions for the same JavaScript value. The precedents that worked
(`orva_documents/lib/projects.ts`, `orva_finance/api/ar/post`) built the literal by hand:
`` `{${ids.join(',')}}` `` — fine for uuids, unsafe for free text such as a SKU with a
comma or a quote.

## Fix

- `src/lib/pgArray.ts` → `toPgTextArray(values)` quotes and escapes every element and
  returns one string for a `?::text[]` (or `?::uuid[]`) placeholder. Unit test beside it.
- Both raw reads in the new code (`orva_stock/lib/marketplaceResolve.ts`,
  `orva_marketing/lib/audience.ts`) bind through it.
- The preview and import routes now catch the resolve step and answer
  `{ error: '... : <message>' }` with status 500, so the next unexpected failure names
  itself.

## Rule

- Raw SQL with a list: `= any(?::text[])` + `toPgTextArray(list)` (or `toUuidArray` from
  tasking for uuids). Never pass the array itself; never build the literal by
  concatenation for text.
- Every route that runs raw SQL after validation wraps the DB step and returns the
  message as JSON — an empty 500 is a silent failure.
- When an ephemeral test fails with `Received: 500` and no text, look for an array
  binding first.
