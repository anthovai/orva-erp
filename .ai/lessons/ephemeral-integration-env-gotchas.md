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

**Rule**: before `yarn test:integration:ephemeral`, stop the dev server and
kill leftover `next start` / `queue worker` processes for this repo. In specs,
authenticate by capturing `set-cookie` from `POST /api/auth/login` (form body,
never JSON) and passing it as a header, and create every fixture record
through the API. When a run reports `exited before readiness check (exit 1)`
with no stack trace, suspect the single-instance lock before suspecting the
code — reproduce with `yarn start`, which names the offending pid and port.

**Applies to**: every `**/__integration__/*.spec.ts` run through
`yarn test:integration:ephemeral` on this machine.
