---
title: "In a Zod union, z.coerce.number() matches null and returns 0 — put the null branch first"
modules: ["orva_documents", "orva_support"]
areas: ["module-data", "debugging", "testing"]
topics: ["zod", "validators", "nullable-numbers", "silent-data-corruption", "integration-tests"]
---

# In a Zod union, z.coerce.number() matches null and returns 0 — put the null branch first

**Context**: 2026-09-10, building H3 (project hourly rates). The integration spec set the
company rate to `null` to clear it and read back `0`.

## Symptom

```ts
defaultHourlyRate: z.union([
  z.coerce.number().min(0).max(1_000_000),   // ← matches null, Number(null) === 0
  z.literal('').transform(() => null),
  z.null(),
]).optional()
```

A union tries its options in order and takes the first that parses. `z.coerce.number()`
runs `Number(input)` before validating, and `Number(null)` is `0`, which passes
`min(0)`. So the null branch is unreachable and "clear this field" silently stores a
zero.

## Why it matters beyond the type

The zero is not a harmless default. The projects screen deliberately reports
`cost: null` when no rate is set, because "0 baht of cost" beside a 100,000 baht quote
reads as pure profit. Storing 0 turned "nobody has priced this project" into "this
project cost nothing to deliver" — the exact misreading the null exists to prevent.
The same union shape was in the retainer amount, where a stored 0 would have billed a
customer nothing and hidden the real fee behind a fallback that never fires.

## Fix

Order the union so the empty cases come first, and say why in the code:

```ts
defaultHourlyRate: z.union([
  z.null(),
  z.literal('').transform(() => null),
  z.coerce.number().min(0).max(1_000_000),
]).optional()
```

`.nullable()` does NOT have this problem — `ZodNullable` short-circuits on `null`
before the inner schema runs, so `z.coerce.number().nullable()` is safe. It is only
hand-written unions that need the ordering.

## Rule

- A nullable coerced number is `z.coerce.number().nullable()`, or a union with `z.null()`
  **first**. Never a union with the coerce branch first.
- Every "this field can be cleared" path gets a unit test asserting null round-trips as
  null (`orva_documents/lib/__tests__/settingsValidator.test.ts`,
  `orva_support/lib/__tests__/subscriptionValidator.test.ts`). A four-minute integration
  run should not be what tells you.
- When a null means something different from a zero in the UI, say so where the value is
  read, so the next person does not "helpfully" default it.
