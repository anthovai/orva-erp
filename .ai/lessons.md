# Lessons

This catalog indexes 22 focused lessons without loading their full text. Route the task first, then read only records whose **modules**, standalone-harness **areas**, or **topics** match the work.

## How to use this catalog

1. Start with the exact module ID when one is named by the task.
2. Add every matching area from the standalone harness router: `architecture`, `module-data`, `umes`, `backend-ui`, `integration`, `ai-workflow`, `debugging`, `testing`, `framework-context`, or `spec-pr`.
3. Use topics to narrow cross-cutting concerns such as `data-scoping`, `optimistic-locking`, `query-index`, or `generated-files`.
4. Open only the linked lesson records that match; do not bulk-read `.ai/lessons/`.

Useful searches:

```bash
rg -n '\b<module-or-topic>\b' .ai/lessons.md
rg -l '"<area>"|"<module>"|"<topic>"' .ai/lessons/*.md
```

## Adding or updating a lesson

- Copy `.ai/lessons/_template.md` to one focused `.ai/lessons/<kebab-case-slug>.md`; update an existing record instead of duplicating it.
- Preserve the front matter keys `title`, `modules`, `areas`, and `topics`. Use `platform` only when no module or package owns the lesson, and put the primary area first.
- Add or update exactly one catalog row under its primary area below. Keep the title stable when code or specs cite it.
- Put hard boundaries in `AGENTS.md`; lessons explain recurring evidence and the durable rule.
- Run `node scripts/check-lessons.mjs` before committing.

## Catalog

### umes

- [Upstream's sales create form claims a document number on open — preview instead, claim on save](lessons/sales-document-numbers-are-claimed-on-form-open.md) — area:umes,debugging; module:orva_documents,sales; topic:document-numbers,route-override,command-interceptor
- [A new dashboard widget is invisible until the role allowlist includes it](lessons/dashboard-widgets-need-role-allowlist.md) — area:umes,backend-ui; module:dashboards,orva_finance; topic:dashboard-widgets,role-allowlist,default-layout

### module-data

- [ce.ts custom fields are inert until `yarn mercato entities install` syncs them](lessons/ce-fields-need-entities-install.md) — area:umes,module-data; module:orva,entities,customers,catalog; topic:custom-fields,ce-dsl,entities-install,definitions-cache
- [A new entity class needs the dev server restarted, not just `yarn generate`](lessons/new-entity-needs-dev-restart.md) — area:module-data,debugging; module:platform,orva_documents,orva_support; topic:mikro-orm,entity-discovery,generated-bundle,dev-server
- [Raw SQL on an encrypted column returns ciphertext, and `??` fallbacks then prefer it](lessons/raw-sql-on-encrypted-columns-leaks-ciphertext.md) — area:debugging,module-data; module:orva_finance,orva,customers; topic:encryption,raw-sql,customer-entities,coalesce,dedupe
- [An updated_at optimistic lock read as .MS and written with now() lets the FIRST write through and 409s every one after](lessons/updated-at-lock-truncates-to-milliseconds.md) — area:module-data,debugging,testing; module:orva_documents,platform; topic:optimistic-locking,postgres,timestamptz,raw-sql,integration-tests
- [schedulerService.register upserts by a uuid id — a readable key is rejected by Postgres and the schedule silently never exists](lessons/schedule-register-needs-a-uuid-id.md) — area:module-data,debugging; module:orva_purchasing,orva_finance,scheduler; topic:scheduler,seed-defaults,uuid,setup,idempotency,real-tenant

### backend-ui

- [t() fallbacks hide missing catalog keys — audit i18n/{th,en}.json whenever strings are added](lessons/i18n-fallbacks-hide-missing-catalog-keys.md) — area:backend-ui; module:orva_documents,orva,orva_party; topic:i18n,translations,catalogs
- [A picker asking for pageSize above the list contract's max renders an empty select, not a capped one](lessons/picker-pagesize-over-contract-empties-the-select.md) — area:backend-ui,debugging,testing; module:orva_purchasing,orva_party,orva_finance; topic:crud-list,pagesize,zod-validation,react-query,quality-states,browser-tests
- [A React Query key is a shape contract: one first segment, one definition file](lessons/query-key-is-a-shape-contract.md) — area:backend-ui,debugging,testing; module:orva_finance,orva_tasking,orva_party,orva_documents,orva_stock,orva_purchasing; topic:react-query,cache,client-side-navigation,quality-states,integration-tests
- [A superadmin's client-side grantedFeatures is EMPTY - a widget features gate hides it from the tenant owner](lessons/superadmin-client-grantedfeatures-is-empty.md) — area:backend-ui,debugging,umes; module:orva_documents,auth,platform; topic:acl,injection-widgets,superadmin-blind-spot,client-side-feature-gate,real-tenant

### testing

- [Four things break an ephemeral integration run before a single test is meaningful](lessons/ephemeral-integration-env-gotchas.md) — area:testing,debugging; module:platform,orva_purchasing; topic:integration-tests,playwright,ephemeral-env,secure-cookie,single-instance-lock,windows
- [A test file without `import { describe, expect, it } from '@jest/globals'` passes jest and fails typecheck](lessons/jest-tests-need-explicit-globals-import.md) — area:testing,debugging; module:orva_purchasing,platform; topic:jest,typecheck,tsconfig,validation-gate
- [A printable sheet can be proven in jest with renderToStaticMarkup — no dev server, no browser](lessons/thai-sheets-are-render-testable-in-jest.md) — area:testing,backend-ui; module:orva_documents,platform; topic:jest,component-tests,react-dom-server,document-templates,playwright-vs-jest-expect

### debugging

- [Flush a DB-generated uuid PK before creating child rows that reference it](lessons/db-generated-uuid-pk-needs-flush-before-child-rows.md) — area:debugging,module-data; module:orva_finance,orva_hr; topic:mikro-orm,primary-keys,posting-routes
- [CRUD list.entityId must be the generated registry id, not a hand-guessed segment](lessons/crud-list-entityid-must-match-generated-registry.md) — area:debugging,module-data; module:orva_hr; topic:crud-factory,query-engine,entity-ids
- [A list bound to raw SQL is ONE Postgres array literal, never a JavaScript array](lessons/raw-sql-array-binding-is-one-literal.md) — area:debugging,module-data; module:orva_stock,orva_marketing,orva_tasking,orva_documents,orva_finance,orva_support; topic:raw-sql,mikro-orm,array-binding,malformed-array-literal,empty-500
- [Reading an installed table from raw SQL: its column types and its columns are not yours to assume](lessons/installed-table-joins-match-the-declared-column-type.md) — area:debugging,module-data; module:orva_support,attachments,platform; topic:raw-sql,type-casts,installed-tables,soft-delete,silent-failure,catch-swallows-errors
- [A catch around a database read must still be holding the error](lessons/a-catch-must-still-hold-the-error.md) — area:debugging,testing,module-data; module:platform,orva,orva_support,orva_finance; topic:catch-swallows-errors,silent-failure,raw-sql,readiness,guard-test,savepoint
- [In a Zod union, z.coerce.number() matches null and returns 0 — put the null branch first](lessons/zod-coerce-number-swallows-null.md) — area:module-data,debugging,testing; module:orva_documents,orva_support; topic:zod,validators,nullable-numbers,silent-data-corruption,integration-tests
- [A new module's defaultRoleFeatures reach no role until `yarn mercato auth sync-role-acls`](lessons/new-module-features-need-sync-role-acls.md) — area:module-data,debugging; module:orva_marketing,auth,platform; topic:acl,role-features,setup,cli,real-tenant,superadmin-blind-spot
- [A new module's customer portal features reach no existing tenant](lessons/customer-portal-features-never-reach-an-existing-tenant.md) — area:debugging,module-data,testing; module:orva_tasking,customer_accounts,platform; topic:customer-roles,portal,rbac,existing-tenant,silent-failure
