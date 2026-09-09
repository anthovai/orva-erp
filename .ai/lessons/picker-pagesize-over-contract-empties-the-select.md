---
title: "A picker asking for pageSize above the list contract's max renders an empty select, not a capped one"
modules: ["orva_purchasing", "orva_party", "orva_finance"]
areas: ["backend-ui", "debugging", "testing"]
topics: ["crud-list", "pagesize", "zod-validation", "react-query", "quality-states", "browser-tests"]
---

# A picker asking for pageSize above the list contract's max renders an empty select, not a capped one

**Context**: `orva_purchasing/components/pickers.tsx` fetched its options with
`pageSize: 200` — for vendor roles, for the vendor parties, and for GL
accounts. Every other picker in the app uses `100`. The purchase-order create
form therefore shipped with **both** dropdowns permanently empty, on every
tenant, and phases A1–A4 all passed their API-level integration specs because
those post `vendorPartyId` and `accountId` directly.

Worse, the form then rendered its empty-state hint —
`ยังไม่มีคู่ค้าที่เป็นผู้ขาย — เพิ่มบทบาท "ผู้ขาย" ในทะเบียนคู่ค้าก่อน` —
which told the operator to go and add a vendor role they already had. The
spec had even recorded "the tenant has no vendor party, so the form cannot be
completed" as an explanation for why the screen was unusable.

**Problem**: `pageSize` in `orva_party`'s and `orva_finance`'s list schemas is
`z.coerce.number().min(1).max(100)`. A larger value does not clamp — it fails
validation, the route answers **400**, `fetchCrudList` throws, react-query
holds an error, and `data?.items ?? []` renders as "no options". The failure
is indistinguishable on screen from an empty database, which is exactly why it
survived four phases of review.

**Rule**: A list-backed picker asks for at most the contract's `pageSize.max`
(100 in this app; grep an existing finance picker rather than guessing), and
the hook returns the query's error alongside its data so the surface can tell
"the lookup failed" apart from "there is nothing to choose". Never let
`?? []` turn a failed request into an empty state — an empty state that
advises fixing data is a lie when the request is what broke.

Past 100 options, the answer is a search-as-you-type picker like
`VariantSearch` in the same file, not a bigger page.

**How it was found**: the first browser walk of the screen
(`orva_purchasing/__integration__/purchasing-screens.spec.ts`), which selects
a vendor and an account by label. Nothing short of opening the page would have
caught it: types, lint, ds:check, 434 unit tests and 26 API-level integration
specs were all green with the form unusable.

**Applies to**: every `useQuery` + `fetchCrudList` picker in
`src/modules/**/components/**`.
