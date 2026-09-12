---
title: "A catch around a database read must still be holding the error"
modules: ["platform", "orva", "orva_support", "orva_finance"]
areas: ["debugging", "testing", "module-data"]
topics: ["catch-swallows-errors", "silent-failure", "raw-sql", "readiness", "guard-test", "savepoint"]
---

# A catch around a database read must still be holding the error

**Context**: Five wrong answers in two days, all from the same shape. The
support portal's attachment list ran `em.execute(…).catch(() => [])` over SQL
that compared `text` to `uuid`; Postgres errored, and the catch reported "this
ticket has no files". The readiness panel read `orva_gl_periods` (never a real
table), `customer_accounts_users` (it is `customer_users`) and
`orva_gl_journals.source_ref` (no such column) — each behind `catch { return
fallback }` — and told the owner there was no open accounting period, no portal
account, and that every invoice was posted. The fourth of those aborted the
shared transaction, so the RLS check never ran and returned its own fallback: a
red blocker, invented, about the guarantee the whole design rests on.

**Problem**: A swallowed read is indistinguishable from an empty result, and
empty results are normal. Nothing logs, nothing 500s, nothing looks wrong — the
failure arrives dressed as an answer and stays until somebody happens to know
the number is false. The false OK ("all invoices posted") is worse than the
false alarm, because nobody investigates good news.

The tempting rules do not work. "Never catch" is wrong — carrying on is often
right. "Must log" and "must not return a literal" both condemn every correct
route handler in this codebase, which reads `error.message`, picks a status and
returns it. The line that actually divides the cases is narrower: **did the
catch look at the error?** Not one of the five did; the route handlers all do.

**Rule**: A catch wrapped around a database read must bind its error and use
it — rethrow, log, return it, or collect it. The proven shape is
`src/modules/orva/api/readiness/route.ts`: one SAVEPOINT per query, failures
pushed onto `missing[]`, and that list returned as `unread`, so a question that
could not be asked shows up as a question that could not be asked instead of as
its fallback. Never `.catch(() => [])` / `catch { return fallback }` on a query.
The one exemption is transaction teardown — `rollback to savepoint`'s own catch
runs on the error path, and letting it throw would replace the real failure with
a secondary one.

`src/lib/__tests__/swallowedDatabaseErrors.test.ts` enforces this across
`src/lib` and `src/modules/orva*`, and carries fixtures of all five original
shapes so the rule cannot quietly stop working. It has an `ACCEPTED` list;
adding to it costs a written reason.

**Applies to**: any raw SQL or ORM read in `src/modules/orva*` and `src/lib`;
see also [Reading an installed table from raw SQL](installed-table-joins-match-the-declared-column-type.md).
