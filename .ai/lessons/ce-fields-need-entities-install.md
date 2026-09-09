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

**Addendum 2026-09-09 — reading values back server-side.** `loadCustomFieldValues`
(`@open-mercato/shared/lib/crud/custom-fields`) returns
`{ [recordId]: { cf_<key>: value } }` — the keys are **prefixed**, exactly as CRUD
list rows carry them. `values[id].shelf_life_months` is silently `undefined`;
`values[id].cf_shelf_life_months` is the value. Two G3 readers were written
against the bare key and both returned null until the rehearsal's lot came back
with no expiry.

**Addendum 2026-09-09 (2) — reading inside the app.** In the G3 rehearsal the
values were written (rows in `custom_field_values`, verified by direct query)
while `loadCustomFieldValues` and the CRUD list decorator both returned null
for them inside the running app — for a product and for a deal, through every
write shape — although the same loader returned them from the CLI against the
dev database. Until that is located, server-side Orva code that must not miss a
stored value reads `custom_field_values` as columns (`value_int`/`value_text`,
`entity_id`, `field_key`, `record_id`, `tenant_id`, `deleted_at is null`) — the
reportQueries precedent — and the harness asserts writes against the table.
Narrowed the same day on the real tenant: the companies list *did* return
`cf_th_tax_id` for stored rows there, where the definitions are tenant-scoped;
the ephemeral app's definitions are tenant-null. Suspect the global-definition
read path, not the loader as such.
