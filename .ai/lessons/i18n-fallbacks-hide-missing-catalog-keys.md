---
title: "t() fallbacks hide missing catalog keys — audit i18n/{th,en}.json whenever strings are added"
modules: ["orva_documents", "orva", "orva_party"]
areas: ["backend-ui"]
topics: ["i18n", "translations", "catalogs"]
---

# t() fallbacks hide missing catalog keys — audit i18n/{th,en}.json whenever strings are added

**Context**: The branded document template, logo/payment settings fields and the
Orva home screen shipped with `t('key', 'ไทย fallback')` calls whose keys were
never added to the module `i18n/{th,en}.json` catalogs. Thai screens looked
fine (the fallback IS Thai), so nothing failed locally — but switching the
locale to English rendered a mixed-language sheet: catalog-backed labels in
English next to Thai fallbacks (user report: "ตัวแปลภาษายังใช้แยกกันอยู่").

**Problem**: The fallback argument makes missing catalog entries invisible in
the language the fallback is written in, so the gap only surfaces in the OTHER
locale — which nobody looks at during Thai-first development. 40 keys across
three modules had drifted this way.

**Rule**: Every key passed to `t()` (and every widget `label`/`labelKey`)
MUST exist in that module's `i18n/th.json` AND `i18n/en.json`. After adding
user-facing strings, diff referenced keys against both catalogs — regex-extract
`t('<module>.…')` plus widget label keys and compare (see
`i18n-audit` approach: scan for `\bt\(\s*'(module\.[\w.]+)'` and
`(label|labelKey):\s*'…'`). Verify by loading the changed screen in BOTH
locales, not just Thai.

**Applies to**: all `src/modules/orva*/i18n/` catalogs; any component using
`useT()`; injection widget `label`/`labelKey` values resolved by the host.
