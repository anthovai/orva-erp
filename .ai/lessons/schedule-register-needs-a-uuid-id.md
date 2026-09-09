---
title: "schedulerService.register upserts by a uuid id — a readable key is rejected by Postgres and the schedule silently never exists"
modules: ["orva_purchasing", "orva_finance", "scheduler"]
areas: ["module-data", "debugging"]
topics: ["scheduler", "seed-defaults", "uuid", "setup", "idempotency", "real-tenant"]
---

# schedulerService.register upserts by a uuid id — a readable key is rejected by Postgres and the schedule silently never exists

**Context**: `orva_purchasing/setup.ts` (Phase A4) registered its daily scan
with `id: 'orva_purchasing.late_scan:<organizationId>'`, copying
`orva_finance/setup.ts`, which had done the same for its two schedules. Unit
tests, typecheck and 37 integration specs were green. Running
`yarn mercato seed:defaults --module orva_purchasing` on the real tenant
printed one line and moved on:

```
WARN [orva_purchasing:setup] Could not register the late delivery scan
     error=invalid input syntax for type uuid: "orva_purchasing.late_scan:0542…"
```

The scan the whole of A4's notification path depends on had never been
registered anywhere. `seedDefaults` catches and warns by design (a schedule
must not block tenant setup), so nothing failed loudly.

**Problem**: `schedulerService.register` does
`em.findOne(ScheduledJob, { id: registration.id })` first, and
`scheduled_jobs.id` is a `uuid` column — a string that is not a uuid throws
before any upsert. Finance's rows exist only because they were created through
an earlier path and carry random ids; re-running its seed today fails the same
way, invisibly.

**Rule**: A schedule id passed to `register` MUST be a uuid, and MUST be the
same uuid every time setup runs, or re-running setup creates a twin next to
the row that is there. Use `src/lib/scheduleId.ts`:

- `stableScheduleId(key)` — a name-based (v5-shaped) uuid for the readable key.
- `resolveScheduleId(em, { key, targetQueue, organizationId })` — the id of the
  schedule a module already has for that queue and organization if one exists
  (whatever id it carries), otherwise the stable uuid. This is what lets
  finance's existing rows keep their ids instead of being duplicated.

And read the seed log. `seed:defaults` succeeds with warnings; a `WARN` from a
module's setup is the failure.

**How it was found**: only by running the seed on the real tenant. The
ephemeral integration harness runs setup too, and would have logged the same
warning — nobody was reading its output for warnings, and no spec asserted the
schedule row existed. A spec that lists `scheduled_jobs` for
`source_module = 'orva_purchasing'` would have caught it in A4.

**Applies to**: every `seedDefaults` that calls `schedulerService.register`.
