---
title: "A new dashboard widget is invisible until the role allowlist includes it"
modules: ["dashboards", "orva_finance"]
areas: ["umes", "backend-ui"]
topics: ["dashboard-widgets", "role-allowlist", "default-layout"]
---

# A new dashboard widget is invisible until the role allowlist includes it

**Context**: 2026-09-03, `orva_finance.dashboard.owner_home` was registered
(`yarn generate` listed it, `defaultEnabled: true`), the user's layout PUT accepted
it, yet the next GET of `/api/dashboards/layout` pruned it and the home showed
nothing. `dashboard_role_widgets` rows exist for superadmin/admin/employee in this
tenant (created 2026-08-30), and `resolveAllowedWidgetIds` intersects a user's
widgets with the role allowlist — a widget absent from every allowlist is disallowed
regardless of ACL features or `defaultEnabled`. `defaultEnabled` also only seeds a
user's *first* layout; existing layouts are untouched.

**Rule**: After adding a dashboard widget, add its id to the tenant's role allowlists
through `PUT /api/dashboards/roles/widgets` (`{ roleId, widgetIds }`, feature
`dashboards.admin.assign-widgets`) and, for existing users, into their layout via
`PUT /api/dashboards/layout` — or document that the operator must do so. Verify with
a GET of the layout, not with the PUT's 200.
