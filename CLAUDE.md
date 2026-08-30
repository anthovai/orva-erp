@AGENTS.md

# Orva project rules (Anthovai)

## Licensing
- `@open-mercato/enterprise` is proprietary and MUST never be added to
  dependencies or wired into `src/modules.ts`. SSO/MFA/record-locking are
  rebuilt clean-room as `@orva/*` modules against public extension points.

## Tenant isolation (PostgreSQL RLS)
- Every tenant-scoped table carries the `orva_tenant_isolation` policy
  (ENABLE + FORCE RLS), installed by `orva_apply_rls()` — see
  `src/modules/orva/migrations/`. Policies are fail-open when the
  `orva.tenant_id` GUC is unset (framework paths: login, migrations, workers)
  and enforce tenant isolation when it is set.
- Any migration that creates a table with a `tenant_id` column MUST end with
  `this.addSql('select orva_apply_rls();')`.
- New `@orva/*` command/service code SHOULD wrap tenant-scoped DB work in
  `withTenantRls(em, tenantId, fn)` from `src/lib/rls.ts` — inside it the
  database itself blocks cross-tenant reads/writes.
- The app MUST connect as the non-superuser `orva_app` role
  (superusers bypass RLS). Role setup / ownership transfer:
  `node scripts/setup-rls-role.mjs` (admin URL in `ORVA_ADMIN_DATABASE_URL`).
- Verify isolation any time with `node scripts/verify-rls.mjs`.
- Caveat: `yarn db:greenfield` recreates the database; CREATE EXTENSION
  (pgvector) requires the admin connection, and `setup-rls-role.mjs` must be
  re-run afterwards.

## Runtime / package manager
- Node ≥24 + Yarn 4 only inside this app (upstream contract). Bun/Rust are
  welcome in standalone tooling and future `@orva/*` sidecar services, never
  as this app's runtime or package manager.
