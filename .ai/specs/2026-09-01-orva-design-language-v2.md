# Orva design language v2 + task-first home

**Date**: 2026-09-01
**Status**: In progress (Tier 1 + Tier 2 approved; Tier 3 declined)

## Problem

The backoffice still reads as Open Mercato with a green coat: same type,
same density, same widget-grid dashboard. docs/BRAND.md explicitly forbids
"OM rebranded". The user asked for a rebuild; owning the whole shell (Tier 3)
was weighed and declined — it would mean reimplementing nav/breadcrumb/command
machinery and carrying it through every upstream upgrade.

## Decisions

- **Voice = typography.** Screen speaks **Anuphan** (contemporary loopless
  Thai — the app's own voice), paper speaks **Sarabun** (the Thai official-
  document face every accountant trusts; used on all printable sheets).
  Loaded via next/font in the app-owned root layout; no runtime fetch.
- **Signature = เส้นคู่บัญชี.** The double ledger rule that closes a total in
  Thai bookkeeping becomes the one memorable structural motif — reserved for
  money figures, never decoration.
- **Home = the day, not a grid.** `/backend` (app-owned page) becomes a Thai
  task-first screen: month money strip (statements + aging APIs), latest
  quotations with one-click document review, and create shortcuts. The
  customizable widget dashboard moves intact to `/backend/dashboard`.
- All Tier-1 changes ride on tokens + app-owned files
  (`src/app/layout.tsx`, `globals.css`, `(backend)/backend/page.tsx`);
  upstream components pick them up untouched.

## Non-goals

Owning AppShell (Tier 3), redesigning every module screen individually,
changing information architecture beyond the home screen.

## Acceptance

- [ ] App UI renders in Anuphan, document sheets in Sarabun (screenshot both)
- [ ] /backend shows the Thai home with live figures; /backend/dashboard
      still serves the widget grid
- [ ] Double-rule appears on money totals only
- [ ] Existing E2E suites still pass
