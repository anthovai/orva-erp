---
title: "Four things break an ephemeral integration run before a single test is meaningful"
modules: ["platform", "orva_purchasing"]
areas: ["testing", "debugging"]
topics: ["integration-tests", "playwright", "ephemeral-env", "secure-cookie", "single-instance-lock", "windows"]
---

# Four things break an ephemeral integration run before a single test is meaningful

**Context**: The first integration suite in this repository (purchasing, six
specs) needed five attempts to run. None of the five failures was a bug in the
code under test — every one was the environment, and each looked like a
different kind of disaster on the way.

**Problem** — in the order they appear:

1. **A running dev server holds the Next build directory.** The runner rebuilds
   the app and dies with `ENOTEMPTY: directory not empty, rmdir
   '.mercato/next/dev/static/chunks/pages'`. Stop the dev server (and any
   `next start`) before any build, integration run included. Already recorded
   for `cargo`; it applies to the Next build the same way.
2. **The ephemeral app is a production build, so session cookies are `Secure`,
   and its base URL is plain http.** A client will not send a Secure cookie
   over http, so Playwright's cookie jar silently sends nothing and *every*
   authenticated call answers `401 Unauthorized` — with a login that returned
   200 three lines earlier. Read the `set-cookie` values off the login response
   and put them on the request context as an explicit `cookie` header.
3. **A leftover production server poisons every later run.** `mercato server
   start` guards one instance per *application directory*, not per port. A run
   that fails after boot leaves `next start` and a queue worker alive; the next
   run picks a fallback port, still hits the guard, and reports only
   `Application process exited before readiness check (exit 1)` with no app
   output. Kill the leftover `next start` / `queue worker` / `test:ephemeral`
   processes for this repo before every run.
4. **The ephemeral tenant has no chart of accounts.** `seedExamples` is off for
   finance, so a fixture that assumes any GL account exists fails with an empty
   list. Fixtures create what they need through the API instead of assuming a
   seed.

The same lock also reports itself as **`Application did not become ready
within 90 seconds. Last probe: GET /login failed: fetch failed`** — every
probe failing with `fetch failed` and no application output at all. One
surviving `mercato` process is enough, and it survives even when the run that
spawned it was killed, so check for leftovers again between consecutive runs:

```powershell
Get-CimInstance Win32_Process -Filter "name='node.exe'" |
  Where-Object { $_.CommandLine -match 'next|mercato' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

5. **`💥 Failed: Command failed: yarn run build (exit 1)` with nothing above it** is
   the runner swallowing the build's output. Run `yarn build` yourself: if it passes
   on the same tree (it did, 2026-09-09, after a `Reset Next build output directory`
   line), the runner's build was environmental — rerun rather than hunt in the code.
   If it fails, the real error is in that output.

**Rule**: before `yarn test:integration:ephemeral`, stop the dev server and
kill leftover `next start` / `queue worker` / `mercato server start` processes
for this repo — before *every* run, not just the first. In specs,
authenticate by capturing `set-cookie` from `POST /api/auth/login` (form body,
never JSON) and passing it as a header, and create every fixture record
through the API. When a run reports `exited before readiness check (exit 1)`
with no stack trace, suspect the single-instance lock before suspecting the
code — reproduce with `yarn start`, which names the offending pid and port.

**Applies to**: every `**/__integration__/*.spec.ts` run through
`yarn test:integration:ephemeral` on this machine.

**Addendum 2026-09-10 — the dev server and the ephemeral build share `.mercato/next`.**
A rerun died at "Building application… ENOTEMPTY: directory not empty, rmdir
'.mercato\next'": the runner clears the Next build directory, and a running
`orva-dev` (Turbopack) holds files in it on Windows. Stop the dev server
before `yarn test:integration:ephemeral`, and check for the previous run's
own app first — `mercato server start`, `next start` and a `queue worker
--all` were still alive after a run that had finished cleanly. Also: the
runner prints nothing until the end (35 min for 47 specs), so a zero-byte
output file is progress, not a hang; `.ai/qa/test-results/artifacts/` fills
up while it runs.
Also from the same day: the sidebar walk in `screens-smoke.spec.ts` stalled for
15 minutes because a create page's CrudForm raised its "unsaved changes" dialog
on the next click, and every later click waited on the overlay — answer the
guard (its confirm button) before and after each navigation. And a run killed
mid-way leaves `.ai/qa/ephemeral-runtime.lock`; the next run then dies with
"Application process exited before readiness check" and no other output.
