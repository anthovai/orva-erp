---
title: "A superadmin's client-side grantedFeatures is EMPTY - a widget features gate hides it from the tenant owner"
modules: ["orva_documents", "auth", "platform"]
areas: ["backend-ui", "debugging", "umes"]
topics: ["acl", "injection-widgets", "superadmin-blind-spot", "client-side-feature-gate", "real-tenant"]
---

# A superadmin's client-side grantedFeatures is EMPTY - a widget features gate hides it from the tenant owner

**Context**: The owner asked for a Preview button on the quote screen. One had
been written months earlier (`orva_documents.injection.quote-documents`,
"Review button at the top of the quote screen") and had never once appeared.
Neither had the งวด list on the quote, nor the document actions on the quote
list rows. All three were correctly registered in `widgets/injection-table.ts`
and present in `.mercato/generated/injection-widgets.generated.ts`.

**Cause**: `InjectionSpot` filters widgets with

```ts
hasAllFeatures(chrome.grantedFeatures, widget.metadata.features)
```

and `hasAllFeatures` is literal:

```ts
if (!Array.isArray(granted) || !granted.length) return false
```

`GET /api/auth/admin/nav` returns, for the tenant's superadmin:

```json
{ "roles": ["superadmin"], "grantedFeatures": [] }
```

A superadmin's access is a **server-side bypass**, not a list of grants. So
every widget that declares `features` is hidden from the superadmin — while
an ordinary employee with the explicit grant sees it.

**This is the usual superadmin blind spot inverted.** The familiar failure
(see [[new-module-features-need-sync-role-acls]]) is that a superadmin sees
*more* than everyone else and so never notices a broken ACL. Here the owner —
the only account that matters on a one-person tenant — sees *less*. The bug is
invisible to exactly the person who would report it, and it presents as "the
feature was never built".

Confirm it in one call from the browser console of any backend page:

```js
await fetch('/api/auth/admin/nav', { credentials: 'include' })
  .then(r => r.json()).then(n => ({ roles: n.roles, granted: n.grantedFeatures.length }))
// → { roles: ['superadmin'], granted: 0 }
```

`POST /api/auth/feature-check` will say `granted: ['orva_documents.view']` for
the same user at the same moment. The server and the client disagree, and the
widget gate reads the client.

## The same codebase gets it right next door

Dashboard widgets carry `features` too, and they work — because
`dashboards/lib/access.ts` passes the bypass explicitly:

```ts
authorizeFeatures(widget.metadata.features ?? [], {
  grantedFeatures: ctx.features,
  unrestricted: ctx.isSuperAdmin,   // ← the injection path has no equivalent
})
```

So this is a gap between the two widget systems, not a deliberate policy, and
the dashboard widgets on this app (`orva_finance` owner-home and
finance-overview) are correctly gated and must be left alone. Only the
injection path needs the gates removed.

## The rule

**Do not put a `features` gate in an app injection widget's metadata** unless
the widget genuinely must be hidden from some staff who can already open the
page. It usually must not:

- the page is already behind its own `requireFeatures`;
- every route the widget calls checks its own features server-side;
- so the metadata gate adds no security, and costs the owner the feature.

When a widget really does need to be hidden from some users, gate it **inside
the component** on something the client actually has — `useBackendChrome()`
exposes `roles` as well — so a superadmin is not mistaken for an
unprivileged user.

**Symptom to recognise**: a registered injection widget that renders nowhere,
with no console error, no failed request, and a correct entry in
`.mercato/generated/injection-widgets.generated.ts`. Check `grantedFeatures`
before suspecting the registration.

**Applies to**: every `src/modules/*/widgets/injection/*/widget.ts` in this
app, and to any installed widget whose absence is being investigated.

**Guarded by** `src/lib/__tests__/injectionWidgetFeatureGate.test.ts`, which
fails with the offending file names if a `features` gate is ever added back to
an Orva injection widget.
