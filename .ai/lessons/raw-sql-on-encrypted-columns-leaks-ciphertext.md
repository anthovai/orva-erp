---
title: "Raw SQL on an encrypted column returns ciphertext, and `??` fallbacks then prefer it"
modules: ["orva_finance", "orva_documents", "customers"]
areas: ["debugging", "module-data"]
topics: ["encryption", "raw-sql", "customer-entities", "coalesce"]
---

# Raw SQL on an encrypted column returns ciphertext, and `??` fallbacks then prefer it

**Context**: `customer_entities.display_name` is encrypted at rest. `openInvoices` in
`orva_finance/lib/reportQueries.ts` resolved a customer name with a three-branch
coalesce whose last branch was a raw subselect:

```sql
coalesce(metadata->'customerSnapshot'->'customer'->>'displayName',
         metadata->'customerSnapshot'->>'displayName',
         (select ce.display_name from customer_entities ce where ce.id::text = …))
```

**Problem**: the subselect returns the *ciphertext*, e.g.
`CX/ToBaj6ZtTXp16:lVyt9Oen…:v1`. Every caller then wrote the correct-looking

```ts
customer: row.customer_name ?? (row.customer_entity_id ? decrypted.get(id) : null)
```

but `??` only falls through on null — and ciphertext is a non-null string, so it **won**
and was rendered to the user. Four call sites were affected (home overview plus three
assistant tools), each of which had already done the decryption work correctly.

It stayed hidden because every real record carried a `customerSnapshot`, so branch 1
matched and branch 3 never ran. A synthetic invoice with `customerEntityId` but no
snapshot surfaced it immediately.

**Rule**: never read an encrypted column in raw SQL. Select snapshots only and leave
the value **null** when no snapshot exists, so the caller's
`findWithDecryption`/`resolveCustomerNames` path is the one that fills it in. A
partially-decrypting query is worse than one that does not try, because a non-null
wrong value defeats every downstream fallback.

**How to spot it**: a name field rendering as base64-ish text ending in `:v1`. Check
whether any `coalesce`/`??` chain can produce a non-null value from an encrypted
column before the decrypting branch is reached.

**Applies to**: `customer_entities.display_name` and any other column in the
encryption map; `orva_finance/lib/reportQueries.ts` (fixed 2026-09-05), and any new
report query joining a CRM table. Related: [[new-entity-needs-dev-restart]] for the
other trap where correct-looking code fails on a seam rather than on logic.
