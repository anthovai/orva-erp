---
title: "CRUD list.entityId must be the generated registry id, not a hand-guessed segment"
modules: ["orva_hr"]
areas: ["debugging", "module-data"]
topics: ["crud-factory", "query-engine", "entity-ids"]
---

# CRUD list.entityId must be the generated registry id, not a hand-guessed segment

**Context**: The orva_hr employees CRUD route declared
`ENTITY_ID = 'orva_hr:employee'`, but the generated registry
(`.mercato/generated/entities.ids.generated.ts`) derives the segment from
the class name: `HrEmployee` → `orva_hr:hr_employee`. The query engine could
not resolve the entity, warned "falling back to table name", queried a
non-existent relation `employees`, and every list request 500'd — the page
had been broken since the module shipped while API create/update (which use
the ORM entity directly) kept working.

**Problem**: `list.entityId` looks like a free-form string and typechecks
either way; the mismatch only surfaces at runtime as an "Unexpected CRUD
error: relation ... does not exist" that reads like a DB problem, not a
naming problem. The tell is the preceding WARN
`Could not resolve entity via ORM metadata ... entity=<id> fallback=<table>`.

**Rule**: Always reference `E.<module>.<entity>` from the generated ids (or
copy the exact string from `entities.ids.generated.ts`) for `list.entityId`,
`indexer.entityType`, and widget/table `entityId` props. Never hand-derive
the segment from the table name — it comes from the PascalCase class name.

**Applies to**: every `makeCrudRoute` in `src/modules/orva_*/api/**` and any
component passing `entityId` to DataTable/CrudForm.
