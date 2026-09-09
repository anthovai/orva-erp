---
title: "A printable sheet can be proven in jest with renderToStaticMarkup — no dev server, no browser"
modules: ["orva_documents", "platform"]
areas: ["testing", "backend-ui"]
topics: ["jest", "component-tests", "react-dom-server", "document-templates", "playwright-vs-jest-expect"]
---

# A printable sheet can be proven in jest with renderToStaticMarkup — no dev server, no browser

**Context**: Phase B1 added a ใบส่งของ that must print WITHOUT prices. The
model-level tests (`showPrices === false`, `amountInWords === null`) all
passed, and the exit gate still could not be claimed: what the customer holds
is the rendered sheet, not the model, and the dev server was unavailable.

**Problem**: The document templates looked like they needed a browser. They do
not. They are `"use client"` React components over plain props — no hooks, no
`window`, no UI-kit imports — and this repo's jest transform already sets
`jsx: 'react-jsx'`, so `renderToStaticMarkup(<Template doc={doc} t={t} />)`
returns the sheet's HTML in a `node` test environment with nothing added to
`package.json`.

Reading that HTML immediately found a defect that model assertions and review
had both missed: the sheet still printed the `การชำระเงิน` bank block, i.e. a
"how to pay" panel on a document with no totals.

**Rule**: When the deliverable is a rendered sheet — invoice, delivery note,
payslip, PDF body — assert against `renderToStaticMarkup` output, not only
against the presentation model. Put the negative assertions in: a sheet that
must not show money is tested by `expect(html).not.toContain('2,400')` and by
the sneakier leaks (`จำนวนเงินเป็นตัวอักษร` spells the total out; the bank
block implies one). Pass `t = (_key, fallback) => fallback ?? ''` so the
fallbacks in the components are what gets read; a key with no fallback then
renders empty, which is itself worth noticing.

Two traps while writing such a test:

- `expect(value, 'message')` does NOT exist in jest — that is Playwright's
  expect, and jest fails the test with "Expect takes at most one argument".
  To name what failed, assert on a filtered list instead:
  `expect(keys.filter((key) => !dict[key])).toEqual([])`.
- Amounts with satang end `...สตางค์`, not `บาทถ้วน`. Assert on the label
  (`จำนวนเงินเป็นตัวอักษร`) or on the exact spelled string, not on a suffix
  you assumed.

**Applies to**: `src/modules/orva_documents/components/templates/**` and any
future pure-React print surface. First example:
`components/templates/__tests__/deliveryNoteRender.test.tsx`.
