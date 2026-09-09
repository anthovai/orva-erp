# Marventine launch readiness — the first batch, end to end, before it is real (Phase G3)

**Date**: 2026-09-09
**Status**: **G3.1–G3.3 shipped and verified 2026-09-09** — the rehearsal runs green end to end (T-G3-1, T-G3-2, T-G3-5), 42 integration specs in all; G3.4 is the owner's: the real SKU and a physical print. Child spec of `2026-09-05-orva-phase-g-roadmap.md` Phase G3 (REQ-008); item 2 of that phase was superseded by `2026-09-08-orva-purchasing-and-delivery-note.md` (the expectation lives on the purchase-order line).

> Written with the same discipline as the purchasing spec: resolved assumptions are marked ⚠ and are the owner's to flip; every phase ends in a gate a machine can run.

## Why now

Everything shipped so far (A–G) was built for the service business, then extended for a product line that **does not exist in the system yet**: there is no Marventine product in the catalog, no lot, no retail sale has ever run with a real SKU, and the label the goods legally need has no surface at all. Purchasing (A1–A4) removed the last blocker on the inbound side. G3 is the rehearsal: run the whole cycle — order → receive into a lot → value it → sell it → post its cost → be warned before it expires — on a throwaway tenant, fix what breaks, and give the lot a label. Only after that does the owner enter the real SKU.

## ⚠ Resolved assumptions (owner may flip any row)

| # | Question | Default taken | Why | Cost to flip |
|---|---|---|---|---|
| A1 | Where does the dry-run run? | **The ephemeral integration harness**, as an integration spec that builds every fixture it needs (warehouse, location, GL accounts, product, vendor, PO). Nothing is created on the real tenant by this phase | the real tenant is production-clean since 2026-09-05; the FDA number, the product name and the pack size are the owner's facts, not the machine's | none — the spec is the checklist |
| A2 | Label geometry | **A4, 3 × 8 = 24 labels of 70 × 37 mm** (the common Thai "24 ดวง" sheet), portrait, no bleed | the most common sheet at every stationer; the layout is a CSS grid, so another sheet is a settings row later | add a second preset |
| A3 | What prints on a label | brand mark, product title, pack size, **เลขที่ใบรับจดแจ้ง (อย.)**, lot number, MFG and EXP as `dd/mm/yyyy` (CE), barcode | Thai cosmetics labelling (ประกาศ คกก.เครื่องสำอาง เรื่องฉลาก) requires the notification number, manufacturing and expiry dates and the lot/batch; CE dates are unambiguous on export cartons too | change the date format in one helper |
| A4 | Barcode symbology | **EAN-13 when the variant carries a valid 13-digit `barcode` (`gtinType` ean13); otherwise Code 39 of the SKU; otherwise no code** | EAN-13 is what a marketplace or a shop scanner expects. Code 39 rather than Code 128 for the SKU: every handheld reads it, and its 43-row table can be checked by eye, where Code 128's 107 rows are exactly where a transcription error hides. A code that will not scan is worse than none, so a SKU outside Code 39's character set prints no code | add a symbology behind `barcodeFor` |
| A5 | Barcode rendering | **A pure encoder in `orva_documents/lib/barcode.ts` (EAN-13 + Code 39), unit-tested against a published EAN-13 reference encoding; bars drawn as SVG `<rect>` elements, never injected markup. No new dependency** | licence discipline and the "ask before dependencies" rule; both tables are small and stable since the 1980s. The reference test earned its place at once: the first draft derived the G-parity patterns as L reversed (they are R reversed) and would have printed EAN-13s that do not scan | swap for a library behind the same function |
| A6 | Where the label lives | **`orva_documents` type `lot_label`**, sourced from `orva_stock` through an optional DI reader (`orvaStockLabelSource`), exactly as `purchase_order` is sourced from purchasing | one print/PDF/brand-logo rail for every sheet; documents never imports stock, and stock never imports the PDF renderer | — |
| A7 | Lot expiry when the receiver leaves it blank | **Defaulted from the product's `shelf_life_months`**: `manufacturedOn ?? receivedOn` + months, at the moment of receipt | the field exists for this and `expiryFromShelfLife` was written for it and never called; an unset expiry silently disables the home screen's expiry alert for that lot | none — an explicit `expiresOn` still wins |
| A8 | COGS timing | unchanged: the retail sale queues cost, `POST /api/orva_stock/cogs { month }` posts it | already the design; the dry-run asserts the journal exists after the monthly post, not after the sale | — |
| A9 | The owner's physical print test | **owner action**, after G3 ships: print one sheet on real label paper and check registration | a machine cannot see paper | — |

## 📝 Requirements

- **REQ-G3-1** — The full Marventine cycle runs end to end on a clean tenant with the real contracts: product with FDA no./shelf life/brand → PO with a goods line → receive into a lot (cost, MFG, EXP) → valuation shows it → retail sale → ใบกำกับภาษีอย่างย่อ prints → stock decremented → COGS posted → home screen warns of the expiring lot. Every step is an assertion, and the spec is the checklist.
- **REQ-G3-2** — A lot's expiry is never silently blank: if the receiver gives none, it comes from the product's shelf life.
- **REQ-G3-3** — A lot prints a label sheet: brand mark, product, pack size, FDA no., lot, MFG/EXP, barcode; via preview, print and PDF like every other sheet; from the lot row on the valuation screen.

## 🧭 Journeys

### J-G3-1 — The rehearsal (REQ-G3-1)
1. Catalog: product "Marventine Body Lotion" with `cf_th_fda_notification`, `cf_shelf_life_months = 24`, `cf_product_brand = MRV`; variant "200 มล." with SKU and an EAN-13 barcode.
2. Purchasing: PO to the OEM, one goods line (the variant, 100 ขวด @ 85), sent.
3. Receive 100 against the PO with lot `MV2609A`, MFG 2026-09-01, no EXP → the lot's expiry is 2028-09-01 (A7).
4. Valuation: the lot shows 100 on hand at 85 = 8,500.
5. Retail sale: 3 ขวด @ 290 gross → invoice, ใบกำกับภาษีอย่างย่อ renders with VAT-inclusive prices; lot on hand 97.
6. COGS for the month → a journal exists; on hand and value agree with 97 × 85.
7. A second receipt with EXP 30 days out → `stock.expiringLots ≥ 1` on the home overview.

### J-G3-2 — The label (REQ-G3-3)
1. Valuation screen → lot row → "พิมพ์ฉลาก" → preview `type=lot_label&documentId=<lotId>&copies=24`.
2. The sheet shows 24 identical labels; print or PDF as any other document; brand mark from the MRV brand profile.

## 🖥️ UI

| Surface | What | Component | States |
|---|---|---|---|
| `/backend/stock/valuation` (existing) | row action "พิมพ์ฉลาก" on every lot with a lot number | `RowActions` / link | — |
| `/backend/documents/preview?type=lot_label&documentId=<lotId>&copies=N` | label sheet | new `LabelSheetTemplate` (chosen by `templateComponentFor` when `isLabelSheet`), `copies` from the query (default 24, max 96) | unknown lot → 404 message; lot without FDA no. → label prints "อย. —" and the preview shows a warning `fda_missing` |

## 🗃️ Data & API

No schema change. `lot_label` is a `DocumentType`; `PrintableDocument` gains `isLabelSheet: boolean` and `labelSheet: LabelSheet | null` (`{ labels: LabelData[]; columns: 3; rows: 8 }`), where `LabelData = { brandName, productTitle, packSize, fdaNotification, lotNumber, manufacturedOn, expiresOn, barcode: { symbology: 'ean13' | 'code128'; value } | null }`. The party blocks, lines and totals are empty on a label sheet and no template reads them.

| Seam | Contract |
|---|---|
| `orva_stock/di.ts` registers `orvaStockLabelSource` | `findLot(em, scope, lotId) → { lot: { id, lotNumber, manufacturedOn, expiresOn }, product: { title, packSize, fdaNotification, brandCode }, variant: { sku, barcode, gtinType } } \| null` — reads `wms_inventory_lots`, `catalog_product_variants`, `catalog_products`, and the product's custom fields through `loadCustomFieldValues` |
| `orva_documents/lib/stockBridge.ts` | `resolveStockLabelSource(container)` — soft, like `purchasingBridge` |
| `GET /api/orva_documents/preview?type=lot_label&documentId=<lotId>&copies=N` | existing route, new branch: `type_unavailable` 400 when stock is not registered; 404 when the lot is unknown |
| `POST /api/orva_stock/receive` (existing) | when `expiresOn` is absent, derive it from the product's `shelf_life_months` (A7); the response carries `expiresOn` so the caller sees what was set |

## 🧪 Tests

| ID | Kind | Fixture | Action | Expected |
|---|---|---|---|---|
| T-G3-1 | integration | warehouse + location + GL (1200 inventory, 5010 COGS) + stock settings + product/variant + vendor | the whole of J-G3-1 through the real routes | every step's assertion in the spec file; the run is the checklist |
| T-G3-2 | integration | as above | receive with `manufacturedOn` and no `expiresOn` | lot `expires_at` = MFG + shelf life; an explicit `expiresOn` still wins |
| T-G3-3 | unit | — | `encodeEan13('8859000000019')`, `encodeCode128('MV2609A')` | module bit patterns equal reference encodings; check digit computed and validated; bad input refused |
| T-G3-4 | unit + render | a `LabelData` | `buildPrintableDocument('lot_label')` → `LabelSheetTemplate` HTML | 24 labels, each carrying the FDA no., lot, `MFG 01/09/2026`, `EXP 01/09/2028`; no party block, no totals; `fda_missing` warning when the number is blank |
| T-G3-5 | integration (browser) | the lot from T-G3-1 | preview page `type=lot_label` | sheet visible, 24 labels, barcode `<svg>` present, no client error; `พิมพ์ฉลาก` on the valuation screen links to it |

## 📦 Phases

| Phase | Outcome | Depends on |
|---|---|---|
| **G3.1 — The rehearsal** ✅ | T-G3-1 written first and run; it found six things (changelog), each fixed in the module that owns it | purchasing A2 (done) |
| **G3.2 — Shelf life sets the expiry** ✅ | A7; T-G3-2 | G3.1 (it was the first thing the rehearsal found) |
| **G3.3 — The label** ✅ | `lot_label` type, encoder, template, stock DI source, row action; T-G3-3/4/5 | none |
| **G3.4 — Owner actions** ⏳ | real SKU with the real FDA no. (and the unit "ขวด" in the catalog dictionary first); a physical sheet printed; check the product form shows the อย. number after saving (finding 5) | G3.1–G3.3 |

## 📝 Rollout & Backward Compatibility

All additive: one new `DocumentType`, two optional fields on `PrintableDocument`, one DI registration, one optional response field on the receive route. No migration. Rollback = hide the row action; the type stays renderable. Nothing is written to the real tenant by this phase.

## 📝 Open Questions

| ID | Question | Owner | Blocking? |
|---|---|---|---|
| Q-G3-1 | Real product facts: name, pack size, FDA notification number, EAN-13 (from GS1 Thailand) | owner | for G3.4 only |
| Q-G3-2 | Which A4 label sheet the owner actually buys (24 ดวง assumed) | owner | no — A2 default |

## 📝 Changelog

| Date | Change |
|---|---|
| 2026-09-09 | Spec written; G3 item 2 recorded as superseded by purchasing A2/A4 |
| 2026-09-09 | **G3.1 rehearsal written first** (`orva_stock/__integration__/marventine-launch.spec.ts`): warehouse + bin + GL 1200/5010 + stock settings + product with `cf_th_fda_notification`/`cf_shelf_life_months`/`cf_product_brand` + EAN-13 variant + OEM vendor, then PO → receive → valuation → retail sale → ใบกำกับภาษีอย่างย่อ → COGS → expiry alert, every step asserted |
| 2026-09-09 | **Found before the first run, by reading:** `expiryFromShelfLife` existed and was never called — a lot received without an explicit expiry had none, which silently switched off the home screen's expiry warning for it. **G3.2 shipped** in `orva_stock/api/receive`: `manufacturedOn ?? receivedOn` + the product's `shelf_life_months` (read through `loadCustomFieldValues`), explicit `expiresOn` still wins, and the response now carries `expiresOn` |
| 2026-09-09 | **G3.3 shipped**: `lot_label` DocumentType with `LabelSheet`/`LabelData` on the model and a `fda_missing` warning; `lib/barcode.ts` (EAN-13 + Code 39, reference-tested); `LabelSheetTemplate` (A4, 3 × 8 of 70 × 37 mm, dd/mm/yyyy, brand mark from the product's document brand, pagination past 24); stock's `orvaStockLabelSource` DI reader (`orva_stock/lib/labelSource.ts`, `di.ts`) and documents' `stockBridge.ts`; the preview route's `lot_label` branch with `copies` (default 24, max 96); "พิมพ์ฉลาก" on every lot row of the valuation screen. 5 render tests, 9 barcode tests |
| 2026-09-09 | **Found by the rehearsal, run 2:** `uom.unit_not_found` — a product's `defaultUnit` must name a unit in the catalog's UOM dictionary, which a clean tenant has none of. Fixture no longer sets one; **owner note:** add "ขวด" (and any other pack unit) under catalog dictionaries before creating the real SKU |
| 2026-09-09 | **Found by the rehearsal, run 3 — the goods seam never worked:** `/api/wms/inventory/receive: Validation failed`. WMS's custom routes parse `scopedSchema.extend(...)` off the **raw body**, so `tenantId` and `organizationId` are required request fields there, not injected from the session; `orva_stock` sent neither, so every goods receipt — and, by the same schema on `/api/wms/inventory/adjust`, every retail issue — would have answered 400. A2's integration coverage was service lines only and never reached this line. Fixed in both `orva_stock` routes: the payload now carries the caller's own scope. This is what the rehearsal exists for |
| 2026-09-09 | **Found by the rehearsal, run 4:** the shelf-life default did not fire — `loadCustomFieldValues` keys every value `cf_<key>` (as CRUD list rows do), and both new readers looked up the bare key. Fixed in `shelfLifeMonthsFor` and `labelSource`; the fixture now also reads the product back and asserts `cf_shelf_life_months` and `cf_th_fda_notification` were stored, so a write-side regression is caught at the product, not at the lot. Also: variant barcodes are unique per tenant, so the fixture mints a distinct EAN-13 per product |
| 2026-09-09 | **Found by the rehearsal, runs 5–8 — an upstream read gap:** the product's custom fields ARE written (a direct query on the runner's database showed `custom_field_values` rows for `shelf_life_months = 24`, the อย. number and the brand, with the product's own tenant and organization), yet inside the running app both the products list decorator and `loadCustomFieldValues` return **null** for them — from three write shapes, and on a deal too. The same loader returns the values when run from the CLI against the dev database, with tenant-scoped or global definitions alike, so the fault is in-app and not yet located. Orva's two readers (`shelfLifeMonthsFor`, `labelSource`) now read `custom_field_values` as columns — the precedent `orva_finance/lib/reportQueries.ts` set for `th_tax_id` — and the fixture asserts the write against the table. **Owner check:** whether the product form on the real tenant shows the อย. number after saving; if not, this is the same gap and goes upstream |
| 2026-09-09 | **Found by the rehearsal, run 9 — a screenshot, not a log:** the preview page rendered the label sheet as a blank invoice (party blocks, empty line table, 0.00 totals). The page called `templateComponentFor({ template, isPayslip })` — only the payslip flag — so neither `isLabelSheet` nor the delivery note's `isDeliveryNote` fallback ever reached the chooser on that screen; the render tests exercised the chooser, the page bypassed it. Fixed: the page hands the whole document to `templateComponentFor`. The delivery-note walk now also forces `template=brand` on the URL and asserts the classic sheet still prints — the page-level half of "refused twice" that B1 claimed and had not proven |
| 2026-09-09 | Also found on the way: `custom_field_values` has `created_at` but no `updated_at` (the first column reader ordered by a column that does not exist and 502'd the receive), and the home overview keeps `expiringLots` under `waiting`, not `stock` |
| 2026-09-09 | **Rehearsal green, run 10**: product → PO → lot (expiry from shelf life) → valuation 100 × 85 → retail sale 3 × 290 → ใบกำกับภาษีอย่างย่อ VAT-inclusive → 97 on hand → COGS posted → expiring lot on the waiting card; label sheet with 24 EAN-13s in the browser and "พิมพ์ฉลาก" on the valuation row. 42 integration specs green |
| 2026-09-09 | The first rehearsal run died in the runner's `yarn run build` with no output; `yarn build` locally passed on the same tree, so the failure was the runner's, not the code's — recorded in the ephemeral-env lesson |
