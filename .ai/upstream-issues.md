# Upstream issues to file against Open Mercato

Two bugs Orva works around in app code. Both workarounds are load-bearing — if either
is fixed upstream, delete the workaround and the lesson with it. File these against the
Open Mercato repository (not `anthovai/orva-erp`); paste as-is.

---

## 1. `PUT /api/sales/invoices` crashes on any partial update — `buildChanges()` output is assigned onto the entity

**Severity**: breaks the route for every partial payload.

**What happens**: the update command diffs the incoming payload with `buildChanges()`,
which returns audit-style `{ from, to }` records, and then `Object.assign`s those records
onto the entity. MikroORM then rejects the write:

```
ValidationError: Trying to set SalesInvoice.issueDate to { from, to }
```

**Reproduce**: `PUT /api/sales/invoices` with any subset of fields (e.g. only
`paidDate` + `metadata`). A full-entity payload masks it, so it only shows up once a
caller sends a partial update.

**Expected**: `buildChanges()` output is for the audit log; the entity should be assigned
the *new values*, not the diff records. Roughly: keep the diff for logging, assign
`after` (or the validated payload) to the entity.

**Impact on us**: Orva cannot use the route to record a payment. `record-payment` owns
the write instead — a direct scoped UPDATE inside `withTenantRls`, merging `metadata`
(the quote linkage must survive) and using `updated_at` as the optimistic lock.
See `src/modules/orva_documents/api/record-payment/route.ts`.

---

## 2. The sales create form claims a document number on mount, burning numbers on every abandoned form

**Severity**: data-quality bug for anyone who needs a continuous series (statutory in TH).

**What happens**: `/backend/sales/documents/create` POSTs `/api/sales/document-numbers`
as soon as it mounts, and that route calls `generator.generate()`, which *increments*
`sales_document_sequences`. Every form the user opens and abandons consumes a number —
our counter drifted 11 → 27 in one day.

Second defect in the same area: switching the type toggle from quote to order leaves the
quote preview in the number field, so orders save with `QTN-` numbers.

**Expected**: the create form should *preview* the next number (read-only, no increment)
and claim it at save. A `preview` vs `claim` distinction on the route, or a
`?peek=true`, would be enough.

**Impact on us**: two overrides, both documented in
`.ai/lessons/sales-document-numbers-are-claimed-on-form-open.md`:
`overrides.routes.api` replaces the route with a previewing handler for quote/order,
and command interceptors on `sales.quotes.create` / `sales.orders.create` claim the real
number at save when the submitted value equals a preview.

---

## 3. Issue #5790 — follow-up

Carried forward from an earlier session's notes as "report upstream / follow up on
#5790", but no description was recorded and nothing in the codebase references it.
**Needs the owner's note on what it was** before it can be filed or chased — otherwise
drop this item.
