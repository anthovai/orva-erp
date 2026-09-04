---
title: "ce.ts custom fields are inert until `yarn mercato entities install` syncs them"
modules: ["orva", "entities", "customers", "catalog"]
areas: ["umes", "module-data"]
topics: ["custom-fields", "ce-dsl", "entities-install", "definitions-cache"]
---

# ce.ts custom fields are inert until `yarn mercato entities install` syncs them

## Symptom

A field added to `src/modules/orva/ce.ts` (code-defined custom entity field)
never appears on the installed entity's forms or in
`/api/entities/definitions`, even after `yarn generate` and a page reload.
Phase E's catalog fields (`th_fda_notification`, `shelf_life_months`,
`product_brand`) sat in code for a day without a matching
`custom_field_defs` row.

## Cause

`yarn generate` only wires ce.ts into the module registry. The definitions
API serves rows from `custom_field_defs`; code-defined fields reach that
table only when `yarn mercato entities install` runs
(`installCustomEntitiesFromModules`). On top of that the definitions API
caches per tenant/org for 5 minutes (`ENTITY_DEFINITIONS_CACHE_TTL_MS`), and
the CLI's cache invalidation happens in the CLI's own process — the dev
server keeps serving its cached list until the TTL lapses.

## Fix / rule

After editing ce.ts: `yarn generate`, then `yarn mercato entities install`,
then wait out (or restart the dev server past) the 5-minute definitions
cache before judging whether the field rendered.
