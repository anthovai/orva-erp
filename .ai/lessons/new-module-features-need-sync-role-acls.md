---
title: "A new module's defaultRoleFeatures reach no role until `yarn mercato auth sync-role-acls`"
modules: ["orva_marketing", "auth", "platform"]
areas: ["module-data", "debugging"]
topics: ["acl", "role-features", "setup", "cli", "real-tenant", "superadmin-blind-spot"]
---

# A new module's defaultRoleFeatures reach no role until `yarn mercato auth sync-role-acls`

**Context**: 2026-09-10, after registering `orva_marketing` on the real tenant (Phase H2).

## Symptom

Nothing visible. The screens worked, the APIs answered 200, and every check passed —
because the account doing the checking was the tenant's superadmin, whose `role_acls`
row carries `is_super_admin = true` and bypasses feature checks entirely. For the
`admin` and `employee` roles the new `orva_marketing.view` / `.manage` features simply
did not exist, so the nav entry and the screen would have been denied to them.

## Root cause

`setup.ts` `defaultRoleFeatures` is applied by `ensureDefaultRoleAcls`, which runs
during **tenant setup**, not on module registration. The obvious-looking command does
something else:

- `yarn mercato seed:defaults --module <id>` runs only that module's `seedDefaults()`
  function (schedules, seed rows) plus `ensureCustomRoleAcls`. It does NOT read
  `defaultRoleFeatures`. It prints a cheerful "seeded=2" that refers to custom roles.
- `yarn mercato entities install` syncs `ce.ts` custom fields. Unrelated to ACLs.

## Fix

```bash
yarn mercato auth sync-role-acls
```

Merges every enabled module's `defaultRoleFeatures` into each role for every tenant
(`--tenant <id>` to narrow, `--no-superadmin` to skip that role). Idempotent.

## Rule

Registering a module in `src/modules.ts` is three steps on an existing tenant, not one:

1. `yarn generate` — discovery, routes, i18n.
2. migrations (the dev runner applies them on boot).
3. `yarn mercato auth sync-role-acls` — the features; plus
   `yarn mercato entities install` when `ce.ts` changed, and
   `yarn mercato seed:defaults --module <id>` when the module has `seedDefaults`
   (schedules, seed rows).

Verify against a NON-superadmin role, or by reading `role_acls.features_json`. A
superadmin session proves nothing about ACL wiring.
