---
title: "A test file without `import { describe, expect, it } from '@jest/globals'` passes jest and fails typecheck"
modules: ["orva_purchasing", "platform"]
areas: ["testing", "debugging"]
topics: ["jest", "typecheck", "tsconfig", "validation-gate"]
---

# A test file without `import { describe, expect, it } from '@jest/globals'` passes jest and fails typecheck

**Context**: Two new test files (`orva_purchasing/lib/__tests__/purchasing.test.ts`
and `src/app/_marketing/__tests__/i18n.test.ts`) were written using the bare
globals. `yarn jest` ran them green — 15 and 3 tests passing — and `yarn
typecheck` then produced roughly a hundred `TS2593: Cannot find name 'describe'`
/ `TS2304: Cannot find name 'expect'` errors from those two files alone.

**Problem**: `tsconfig.json` does not put `jest` in `types`, so the runner's
globals exist at runtime but not to the compiler. The green test run is the
misleading signal: it says the file is correct while the repository gate says
it does not compile, and the error count is large enough to bury whatever else
the typecheck was meant to catch.

**Rule**: Every test file starts with
`import { describe, expect, it } from '@jest/globals'` (add `test`, `beforeEach`
and friends as used). Every existing test in this repo already does — copy the
first line of `orva_time/lib/__tests__/hours.test.ts` when creating one. Run
`yarn typecheck`, not only `yarn test`, before believing a new test file is
finished.

**Applies to**: every `**/__tests__/*.test.ts(x)` file in `src/`.
