# Time tracking ownership, and keeping โครงการ in step with โปรเจกต์

> **Status: skeleton — Open Questions gate not yet cleared.** Nothing here is
> built. `om-spec-writing` requires the skeleton to stop for answers before the
> data model is designed, and the questions below are the ones where a wrong
> assumption forces the schema to be rewritten.

## 📝 TLDR

Orva shows the owner three screens that each call something a project: งาน
(`orva_tasking_projects` — the work), การเรียกเก็บตามโปรเจกต์ (`sales_quotes` —
the money), and โครงการ (`staff_time_projects` — the timesheet cost centre).
The first two are already tied together by a `quote_id`. The third holds zero
rows, so the page upstream ships — KPI strip, saved views, hours sparkline,
members — has nothing to show. This spec settles who owns a time-tracking
project and keeps โครงการ in step with the work automatically, so hours can be
logged against the same projects the Gantt draws.

## 📝 Problem Statement

- `staff_time_projects` is empty on this install while `orva_tasking_projects`
  holds 8 projects and 87 tasks. The owner opened โครงการ expecting the work.
- `.ai/specs/2026-09-04-orva-department-benchmark.md` (line 101) already
  committed to exposing `timesheets/projects → Projects`. That is done. What it
  did not settle is where the rows come from.
- `.ai/specs/2026-09-06-orva-tasking-parity.md` puts time tracking in
  **Non-goals** and says, verbatim, that it "belongs in its own spec, and
  `orva_hr` already owns staff, so the ownership question is real and should not
  be settled inside a tasking spec" (Q-005, unanswered). This spec exists to
  answer that question rather than smuggle it into `orva_tasking`.
- Two tables holding the same project name is a drift surface. The owner's ask
  was explicitly "sync กันทั้งระบบ … ไม่มีบักหรือ error", so drift is the risk
  this spec has to design against, not a detail.

## 📝 Proposed Solution (sketch — subject to the answers below)

A tasking project is the source of truth for *what the work is*. A matching
`staff_time_projects` row is created and kept in step post-commit through a
domain event, so hours land on the same project the board and the Gantt show,
and upstream's timesheet screens keep working unmodified.

This requires three things Orva does not have yet:

1. **Events on tasking projects.** `orva_tasking` emits nothing today. New
   event definitions are additive (`events.ts` / `createModuleEvents()`), so no
   existing contract moves.
2. **A durable mapping** between a tasking project and its time project, owned
   by whichever module Q1 names, so the link survives a rename and an edit to
   the upstream `code`.
3. **A reconcile path** — a CLI that backfills the 8 existing projects and
   repairs drift. An event stream alone cannot fix a row that was missed while
   a worker was down; sync that is only ever event-driven is the bug the owner
   asked to avoid.

Alternatives already rejected, and why:

| Alternative | Why it lost |
|---|---|
| Replace the โครงการ page with an Orva screen over `orva_tasking_projects` | Throws away upstream's KPI strip, saved views, sparkline and members, which is most of the value of the page |
| Show only a work count on โครงการ, no sync | The owner was offered this and chose automatic sync; it also leaves hours unloggable against real projects |
| Hide โครงการ and put hours on the tasking project | Rebuilds a timesheet model `staff` already owns — forbidden by the reuse rules in `AGENTS.md` |
| Match rows by `code` instead of a mapping table | `code` is user-editable upstream and unique per org; a user editing it silently breaks the link |

## 📝 Architecture (boundaries only, pending Q1)

- `AGENTS.md` forbids cross-module ORM relations. The link is a scalar ID pair
  plus a tenant, whichever module holds it, and is read with tenant-filtered
  SQL inside `withTenantRls`.
- The effect is post-commit: a subscriber, never a write inside the tasking
  transaction.
- Any new table carrying `tenant_id` ends its migration with
  `select orva_apply_rls();` (CLAUDE.md).

## ❓ Open Questions

**Q1 — Who owns the mapping?** `orva_tasking` (the work knows its cost
centre), `orva_hr` (the tasking spec's own hint: HR owns staff), or a new
`orva_time` module? This decides which module's migration adds the table and
which one may read the other's ids.

**Q2 — One-way or two-way?** Is the tasking project always the source of truth
and โครงการ a derived mirror (a row created there by hand is an orphan), or may
a time project exist on its own — for work that is not a tasking project at all,
such as internal admin or leave?

**Q3 — What does archiving mean?** A tasking project is archived, or
soft-deleted. Does its time project become `completed`, get soft-deleted, or
stay untouched? Hours already logged against it must survive either way — is
that right?

**Q4 — Every project, or only billable ones?** 4 of the 8 tasking projects
carry no quotation (งานภายใน). Do they get a time project too, or is a
quotation the trigger?

**Q5 — Who owns `code`?** Upstream's `code` is user-editable and unique per
organization. May Orva generate and then lock it (the page becomes partly
read-only), or must the sync tolerate the owner editing it freely?

---

*Answer these and the Data Model, API Contracts, Edge Cases, Risks and Phasing
sections get written against the answers. No migration is generated and no code
is written before then.*
