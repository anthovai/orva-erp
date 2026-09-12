---
title: "A new module's customer portal features reach no existing tenant"
modules: ["orva_tasking", "customer_accounts", "platform"]
areas: ["debugging", "module-data", "testing"]
topics: ["customer-roles", "portal", "rbac", "existing-tenant", "silent-failure"]
---

# A new module's customer portal features reach no existing tenant

**Context**: `orva_tasking` ships a customer portal for project work, gated on
`orva_tasking.portal.view`, and declares that feature for `portal_admin`,
`buyer` and `viewer` in its `setup.ts` `defaultCustomerRoleFeatures`. On
2026-09-12 an integration spec could not open the page it was written to test.
Checked against the live tenant:

    buyer          7 features   orva_*: none
    portal_admin   1 feature    orva_*: none
    viewer         4 features   orva_*: none

The feature was granted to nobody, so every customer met 403 on the work
portal. It had been that way since the module shipped.

**Problem**: `defaultCustomerRoleFeatures` is merged into `customer_role_acls`
by `customer_accounts.seedDefaults`, which runs at tenant creation. A tenant
that already existed when the module was added never gets the merge, and
nothing re-runs it. This is the customer-role twin of
[[new-module-features-need-sync-role-acls]] — but `yarn mercato auth
sync-role-acls` does **not** cover it, because that command syncs staff role
ACLs, not customer ones.

Three things kept it invisible for days:

  1. The portals disagree on how they gate. `orva_documents`' billing portal
     checks only that the account is linked to a customer entity; the tasking
     portal checks a feature. So the customer could read their invoices and
     not their project, which reads as one broken page rather than a missing
     grant.
  2. The superadmin account bypasses feature checks entirely, so walking the
     screens signed in as the owner proves nothing about what a customer sees.
  3. Upstream's call site wraps the merge in a bare `try {} catch {}`. Had it
     ever thrown, nothing would have said so — the same shape as
     [[a-catch-must-still-hold-the-error]].

Diagnosis cost three ephemeral runs because the first symptom was an empty
comment list, not a refusal: the spec read `body.comments ?? []` without
asserting the status, so a 403 body became "this project has no comments".

**Rule**: When an app module declares `defaultCustomerRoleFeatures`, granting
it on tenants that already exist is a separate, manual step. Run
`node scripts/grant-customer-portal-features.mjs --dry` to see what is
missing, then without `--dry` to write it; it is additive and idempotent, and
exits non-zero if a grant did not stick. Add the module's grants to that
script's `PORTAL_FEATURES` in the same commit as the `setup.ts` declaration —
`src/lib/__tests__/customerPortalGrantsMatchSetup.test.ts` fails if you do
not.

Never verify a portal as superadmin. Sign in as a customer with a real
customer role, or assert it in an integration spec that creates the role and
grants the feature explicitly rather than trusting the environment to have
done it.

**Applies to**: any `src/modules/orva*/setup.ts` declaring
`defaultCustomerRoleFeatures`; `src/modules/orva_tasking/lib/portalScope.ts`;
`scripts/grant-customer-portal-features.mjs`;
`src/modules/orva_tasking/__integration__/daily-work-loop.spec.ts`.
