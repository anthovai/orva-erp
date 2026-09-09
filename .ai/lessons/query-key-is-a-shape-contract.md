---
title: "A React Query key is a shape contract: one first segment, one definition file"
modules: ["orva_finance", "orva_tasking", "orva_party", "orva_documents", "orva_stock", "orva_purchasing"]
areas: ["backend-ui", "debugging", "testing"]
topics: ["react-query", "cache", "client-side-navigation", "quality-states", "integration-tests"]
---

# A React Query key is a shape contract: one first segment, one definition file

**Context**: 2026-09-10, after the owner hit the crash below on the real tenant.

## Symptom

`allAccounts.filter is not a function` at `ExpensesPage.tsx:65`, only when the
owner clicked ค่าใช้จ่ายจ่ายสด in the sidebar after ใบวางบิลผู้ขาย (or five other
finance screens). Loading the URL directly never reproduced it, so the
2026-09-05 fix could not reproduce it either — and made it worse by unwrapping
to an array while six sibling screens kept caching the `{ items }` envelope
under the very same key.

## Root cause

Seven screens each declared `useQuery({ queryKey: ['orva_finance.accounts.all', scopeVersion] })`
with their own queryFn. React Query shares the cache by key, not by call site,
so whichever screen rendered first decided what every later screen read. The
cache only survives between screens on client-side navigation; a reload starts
it empty. The same thing had already happened once (`orva_tasking.projects`,
2026-09-07) and was recorded as a memory, not as a test — so it recurred.

## Fix / rule

- **One first segment, one file.** A shared query lives in the module that owns
  the route, as an exported hook (`orva_finance/components/queries.ts`,
  `orva_party/components/queries.ts`, `orva_documents/components/queries.ts`,
  `orva_tasking/components/queries.ts`, `useVariantSearch` in orva_stock).
  Consumers import the hook; a screen wanting a different filter or shape uses
  a different key. Hooks return the unwrapped array plus `isLoading`/`failed`.
- **Enforced:** `src/lib/__tests__/queryKeyOwnership.test.ts` scans every
  `useQuery` block under `src/modules/orva_*`, resolves keys held in a
  variable, and fails on any first segment defined in two files.
- **Exercised:** `src/modules/orva/__integration__/screens-smoke.spec.ts`
  opens every static Orva page by URL and then clicks every sidebar link
  forward and backward — every ordered pair of screens renders on top of what
  the other left in the cache.
- **Verify by clicking**, not by loading URLs, whenever two screens read the
  same endpoint. Filters like `isActive:true` are part of the contract too: a
  "different params, same key" pair silently shows one screen the other's
  subset.
