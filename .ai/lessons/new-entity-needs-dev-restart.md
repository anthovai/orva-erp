---
title: "A new entity class needs the dev server restarted, not just `yarn generate`"
modules: ["platform", "orva_documents", "orva_support"]
areas: ["module-data", "debugging"]
topics: ["mikro-orm", "entity-discovery", "generated-bundle", "dev-server"]
---

# A new entity class needs the dev server restarted, not just `yarn generate`

## Symptom

You add an entity class, run `yarn generate`, typecheck passes, the migration is
applied and the table exists with RLS. Then the first **write** fails with:

```
MetadataError: Metadata for entity SupportSubscription not found
  at tem.create(SupportSubscription, { ... })
```

Confusingly, **reads keep working** if they go through raw `tem.execute(...)` SQL —
raw SQL needs no entity metadata. So a list page renders happily while POST/PUT
return 500, which makes it look like a payload or validation bug. It is not.

## Why

Runtime entity discovery reads `.mercato/generated/entities.generated.mjs` — a
*compiled bundle* that inlines every entity class. Two things conspire:

1. `entities.generated.ts` uses `import * as E_mod from '.../data/entities'` and
   spreads the namespace, so it needs no regeneration when you add a class to an
   existing file — it is already correct, which makes it look like nothing is wrong.
2. The `.mjs` bundle is compiled at **dev-server boot** and the running process holds
   the old module in memory. `yarn generate` reports "Generated outputs unchanged"
   and will not rebuild it; deleting `entities.generated.checksum` or the
   `*.cache.json` metadata does not help either, because the stale copy is already
   imported.

## Fix

Restart the dev server. That is the whole fix.

Do not go hunting through generator caches (as this session did) — check the entity
bundle first:

```bash
grep -c "your_table_name" .mercato/generated/entities.generated.mjs
```

`0` while the class exists in `src/modules/<id>/data/entities.ts` means exactly this,
and the bundle's mtime will match when the server booted.

## How to apply

When adding an entity, plan for a restart before verifying any write path. If a write
500s and reads work, check the bundle before suspecting the schema, the validator or
the payload. Related: [[ce-fields-need-entities-install]] — same shape of trap, where
code-defined data is inert until a separate step catches up.
