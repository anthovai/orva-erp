# จัดซื้อ (purchase orders) and ใบส่งของ (delivery note) — closing the two ends of the goods cycle

**Date**: 2026-09-08
**Status**: **Track A complete — phases A1–A4 shipped and verified 2026-09-08.** The three-way match reads from facts (ordered, received, billed) and the owner sees what is late and what is committed without opening the module. Migrations applied; 19 integration specs pass against a production build on an ephemeral database. Track B (ใบส่งของ) is untouched and independent; TEST-010 (a human or a browser walking the screens) is the standing gap across all of Track A.

> Written with `om-spec-writing`. Companion to `2026-09-04-orva-department-benchmark.md`
> (Stock: "Purchase order to OEM → bill → receive ❌", Sales: "ใบส่งของ ⏸") and
> `2026-09-05-orva-phase-g-roadmap.md` (G3.2 "expected receipt on bill lines" — **superseded**
> by Track A of this spec: the expectation belongs on the order, not on the bill).

## 📝 TLDR

Orva today books what a vendor *charged* (AP bill) and what the warehouse *received* (WMS
lot with cost), but nothing records what the owner *ordered* — so there is no way to see
"สั่งไป 500 ขวด บิลมา 500 รับจริง 480" until the money is already spent. On the selling side
Orva prints every Thai billing document except the one that travels with the goods. This
spec adds two independently shippable tracks: **Track A — `orva_purchasing`**, a new app
module that owns the purchase order (ใบสั่งซื้อ), its lifecycle, and the three-way match
against `orva_finance` bills and `orva_stock` receipts; **Track B — `delivery_note`**, a new
`orva_documents` type (ใบส่งของ) printed from an invoice, carrying delivery facts (who
received, when, by which carrier) stored on the invoice's existing metadata. Both reuse
installed rails — `orva_party` vendors, `catalog` variants, `wms` receive, the documents
preview/PDF/email pipeline, the home waiting card — and add no dependency.

## Resolved assumptions (autonomous defaults)

| # | Question | Default taken | Why this default | Flip it if… |
|---|---|---|---|---|
| A0 | Two capabilities in one spec? Purchasing and the delivery note ship independently (the scope-cohesion test in `om-spec-writing` says split) | **One document, two tracks (A, B), separate phases, separate exit gates, separate tests.** The request named them together as "the goods cycle". The tracks share exactly one file — the type registry in `orva_documents/lib/document.ts` (`DOCUMENT_TYPES`, `HEADINGS`, `templateFor`) — where both additions are independent list entries that commute | you want separate review cadences → split at the Track B heading and duplicate the Users/Security boilerplate; the registry edits merge trivially |
| A1 | Where does the PO live: `orva_stock` (benchmark said "light PO in orva_stock") or a new module? | **New module `orva_purchasing`.** A PO is a *commitment* (ordered qty × price to a vendor) — an invariant neither the ledger (liability) nor the warehouse (quantity) owns. Kaiser also buys services (hosting, subcontract) that never touch stock | the owner only ever orders stocked goods → still a module; the stock-only shortcut saves ~2 files and loses service POs |
| A2 | Approval workflow on a PO? | **No.** One-person company; `draft → sent` is the approval. No `approve` feature is declared either — an ungranted feature only clutters the role editor until something checks it (A1 declares `view`, `manage`, `receive`, `bill`) | a second person joins and the owner wants to sign off → add an `approved` state + `workflows` user task (child spec) |
| A3 | Over-billing (bill total > PO total) | **Warn, allow** — confirmed by the owner 2026-09-08. Vendors add freight/rounding; the variance is shown on the PO and on the bill link, never blocks posting | a hard cap would be a settings flag (`409 over_billed`); not built |
| A4 | Over-receipt (received qty > ordered qty) | **Block with 409.** Same rule G3.2 planned. A physical over-delivery is recorded by first **increasing** the line quantity (the one edit a sent PO allows, with a reason, emitting `order.line_adjusted`), then receiving | — |
| A5 | PO number series | **Module-owned, `PO-{yyyy}{mm}-{seq:4}`, one counter per organization**, not a brand series — a PO is issued by the legal entity, not by Kaiser/Marventine branding | the owner wants MRV-PO-… → brands gain a `po_number_format`; deferred |
| A6 | Delivery note source record | **The invoice** (`sales_invoices`), never `sales_shipments`. Shipments require a `sales_order` (FK), orders are hidden in the Kaiser profile, and the retail sale creates an invoice directly | orders are re-enabled for a marketplace tenant → add `sourceKind: 'shipment'` alongside; the sheet builder is already type-driven |
| A7 | Does confirming a delivery move stock? | **No.** Stock issue happens at the retail sale today; B2B stock issue from an invoice is a Marventine-launch concern (`orva-marventine-launch.md`), not a document concern | you sell Marventine B2B before that spec exists → Phase B3 (design only, below) |
| A8 | Delivery facts storage | **`sales_invoices.metadata.delivery`** (json, additive), the same seam that already carries `quoteId`. No new table — confirmed by the owner 2026-09-08 | multiple partial deliveries per invoice become real → promote to `orva_documents_deliveries` (one row per note); revisit before the second Marventine batch |

## 📝 Problem Statement

- **Three numbers, two recorded.** `orva_ap_bills` records the vendor's charge; `orva_stock_lot_costs` records the receipt (`bill_line_id`, `received_qty`); `GET /api/orva_stock/bill-lines` already shows received-vs-billed. Nothing records *ordered*, so a short delivery, a price change between quote and bill, or a bill for something never ordered is invisible until the owner reconciles by memory.
- **The OEM buy is the biggest single cash event of the Marventine business** (spec 2026-09-03: OEM purchasing with input VAT). A batch is ordered weeks before it is billed and received; the home screen's four questions cannot show "money committed but not yet due" without an order record. Phase G3.2 tried to put `expected_qty`/`expected_on` on *bill lines* — but a bill arrives with or after the goods, so the expectation would be recorded after the fact.
- **Services are purchased too.** Hosting, domains, subcontracted development: `orva_support` subscriptions track the *renewal*, AP tracks the *bill*, nothing tracks the *order/quote accepted from the vendor*. Not urgent, but the same record.
- **The paper that travels with the goods is missing.** Thai practice hands over a ใบส่งของ (or ใบส่งของ/ใบแจ้งหนี้) signed by the receiver; for VAT goods the tax invoice must be issued at delivery, and the signed delivery note is the proof of the delivery date. `orva_documents` prints ten types and not this one (benchmark row: ⏸). Retail parcels (Marventine via LINE/marketplace) also need a packing slip with tracking.
- **Evidence:** `DOCUMENT_TYPES` in `src/modules/orva_documents/lib/document.ts` has no delivery type; `src/modules/orva_stock/api/receive/route.ts` writes `referenceType: 'po'` with a *bill* id because no PO exists; `orva_finance/api/home/overview` has no "committed" figure.

## 📝 Overview and Success Measures

- **Primary outcome:** every Marventine OEM batch and every vendor order above the owner's own threshold exists as a PO *before* its bill; the PO detail shows ordered / billed / received in one row. Target: 100% of AP bills carrying a stock receipt are linked to a PO within 60 days of Phase A2.
- **Leading indicators:** POs created per month; % of `orva_ap_bills` linked to a PO; number of `orva_stock_lot_costs` rows with `bill_line_id` but no PO link (should fall to zero for new receipts); delivery notes printed per invoice with goods lines.
- **Baseline:** 0 POs (no table). Stock receipts: the Marventine flow is untested end to end (no real lot yet). Delivery notes: 0 (no type).
- **Market / product reference:** Odoo 17 Purchase (RFQ → PO → receipt → bill, three-way match on "Bill Control: on received quantities"); ERPNext Buying (Purchase Order → Purchase Receipt → Purchase Invoice, per-line `received_qty`/`billed_amt`); Dolibarr Supplier Orders. **Adopted:** per-line ordered/received/billed quantities as the match; receipt against the order, not the bill; PO as a printable/sendable document. **Rejected:** RFQ/quotation-comparison stage (one vendor per product line), approval matrix, blanket orders, landed-cost allocation, multi-currency — none matches a one-person Thai company today. For the delivery note: FlowAccount/PEAK print ใบส่งของ from the invoice with a receiver signature block and optional prices; adopted as is.

## 📝 Goals

- **REQ-001** — The owner creates a PO to a vendor party with lines (catalog variant *or* free-text service, qty, unit price ex-VAT, VAT mode, expected date, expense/inventory account), previews and prints/emails it as ใบสั่งซื้อ in the Thai document rails. (Track A)
- **REQ-002** — A PO moves through `draft → sent → partially_received/received → closed` or `cancelled`, with optimistic locking; a `sent` PO's lines are frozen except `expected_on`. (A)
- **REQ-003** — From a PO the owner issues an AP bill pre-filled with the PO lines; the bill is linked per line to the PO and the PO shows billed amount and price variance. (A)
- **REQ-004** — From a PO the owner receives stocked lines into WMS (lot, expiry, cost from the PO line) and marks service lines fulfilled; the PO shows received qty per line and refuses over-receipt. (A)
- **REQ-005** — The home waiting card lists PO lines past `expected_on` and not fully received ("ของที่สั่งแล้วยังไม่ได้รับ"), and the money panel shows committed-not-billed PO value. (A)
- **REQ-006** — An invoice prints as ใบส่งของ (delivery note): goods lines with quantities, optional prices, delivery address, carrier/tracking, receiver signature block; via preview, PDF, public link and email like every other type. (Track B)
- **REQ-007** — The owner records delivery facts on an invoice (delivered on, receiver name, carrier, tracking numbers, show-prices flag) from the invoices list, with conflict handling, and the note prints them. (B)

## 📝 Non-goals

- RFQ / vendor quote comparison, approval chains (A2), blanket/framework orders, drop-ship, landed costs, multi-currency, purchase returns (debit note to vendor — separate spec when the first one happens).
- Vendor portal or vendor-facing acceptance link (the PO is emailed as PDF).
- Stock issue on delivery (A7); `sales_shipments`/`shipping_carriers` labels (A6; `shipping_carriers` stays disabled in `src/modules.ts`).
- ใบรับสินค้า (goods receipt note) as a printable document — the receipt is recorded, not printed, until asked.
- Any change to `orva_finance` posting rules or to `orva_stock` valuation math.

## 📝 Proposed Solution

**Track A.** A new app module `src/modules/orva_purchasing/` owns four tables — orders, lines, receipts, bill links — plus a settings row. It *orchestrates* and never re-implements: vendors are `orva_party` parties with the `vendor` role (the picker already used by `BillCreateForm`); products are `catalog` variants (optional per line); the bill is created by the existing AP bill form/route, prefilled from the PO, and then *linked* to the PO by purchasing (two steps, no internal write into finance); the stock receipt goes through the existing `POST /api/orva_stock/receive` with two additive fields (`referenceType`, `referenceId`) so the WMS movement points at the PO. `orva_finance` and `orva_stock` stay ignorant of purchasing; purchasing holds the links. The printable ใบสั่งซื้อ is a new `orva_documents` type `purchase_order` with `sourceKind: 'purchase_order'`, resolved through an optional-DI reader the purchasing module registers (documents already does this for payroll lines).

**Track B.** `orva_documents` gains `delivery_note` in `DOCUMENT_TYPES` with `typesForSourceKind('invoice')` extended; `buildPrintableDocument` gets a delivery block (address, carrier, tracking, receiver, delivered-on, `showPrices`). Delivery facts are written to `sales_invoices.metadata.delivery` through the installed `sales.invoices.update` command from a small dialog on the invoices list (RowActions → "บันทึกการส่งของ"), guarded by the invoice's `updatedAt`. No new table (A8).

Why this is the smallest platform-native shape: it adds one module where an invariant is genuinely new (the commitment), one document type where the rails already exist, and zero columns to any other module's tables except two optional request fields on one `orva_stock` route.

### Design Decisions and Alternatives

| Decision | Rationale | Alternative considered | Why rejected / deferred |
|---|---|---|---|
| New module `orva_purchasing` (A1) | Owns the ordered/billed/received invariant; services and goods alike | Tables inside `orva_stock` | Couples a service PO to a warehouse module; `orva_stock` would then call `orva_finance` for bills *and* own commitments |
| Purchasing holds the bill link (`orva_purchasing_bill_links`) | `orva_finance` stays ignorant; a bill can still exist without a PO | `purchase_order_id` column on `orva_ap_bills` | Finance would carry a foreign concept; harder to delete purchasing later |
| Receipt goes through `orva_stock` receive, purchasing records the receipt row | Cost-per-lot and WMS calls stay in one place; purchasing adds only the PO line reference | Purchasing calls WMS directly | Two writers of `orva_stock_lot_costs`; valuation would fork |
| PO → bill is **two steps**: the bill is created by the existing finance form/route (prefilled from `bill-draft`), then purchasing links the *existing* bill (`POST …/bill { billId, allocations }`) | Purchasing never creates a finance record, so no half-written bill can exist; a bill without a PO is legal anyway; linking is idempotent and can be repeated from the UI ("ผูกบิลที่มีอยู่") | Purchasing creates the bill through an internal API call and then links | A failure between the two writes leaves a bill with no anchor back to the PO (no PO column on `orva_ap_bills` by decision), so it could not be reconciled |
| `purchase_order` document type resolved via optional DI (`purchasingDocumentSource`) | Documents cannot import purchasing (module order/optional); DI resolve degrades to "type unavailable" | Documents queries `orva_purchasing_*` tables by raw SQL | Documents would know purchasing's schema; A/B independence lost |
| Delivery facts in `sales_invoices.metadata.delivery` (A8) | Additive, same seam as `quoteId`; one note per invoice covers the business | New `orva_documents_deliveries` table | Needed only for partial deliveries; flagged ⚠ for promotion |
| Delivery note not a tax document | It carries no VAT claim; taxpayer ids print only if `showPrices` | Treat as ใบส่งของ/ใบกำกับภาษี combined | That is the existing `tax_invoice` type; users pick it when they want the combined sheet |
| No `sales_shipments` (A6) | Hard FK to `sales_order`, orders hidden | Create a shadow order per invoice | Fabricates records the profile does not use |

## 📝 Domain Vocabulary and Business Rules

| Term / invariant | Precise meaning or rule | Source of truth | Failure behavior |
|---|---|---|---|
| ใบสั่งซื้อ / PO | A numbered commitment to buy N lines from one vendor party at stated ex-VAT prices; VAT mode per line (`none`/`7`) | `orva_purchasing_orders` | — |
| PO line kind | `goods` (has `catalog_variant_id`, receivable into WMS) or `service` (free text, fulfilled without WMS) | `orva_purchasing_order_lines.kind` | `goods` without variant → 400 |
| `status` | `draft` → `sent` → (`partially_received` ↔) `received` → `closed`; `draft`/`sent` → `cancelled`. Derived states (`partially_received`, `received`) are recomputed from receipts on every receipt write; `cancelled` only with zero receipts and zero bill links | `orders.status` + receipts | Illegal transition → 409 `invalid_transition` |
| `closed` | Manual, from `sent`/`partially_received`/`received`, with `reason`. Sets `closed_at`; every line's `short_qty = ordered − received` is frozen as the recorded shortfall; the PO leaves the late scan and the committed figure; no further receipts or bill links accepted (409 `closed`). `closed` is the only way to stop chasing a short delivery | `orders.status`, `closed_at` | Receive/bill on closed → 409 `closed` |
| Frozen after `sent` | Vendor, line kind/variant/price/VAT/account immutable, no line add/delete. Editable: `expected_on`, `memo`, `vendor_reference`, and **line `quantity` upward only** (with `reason`; emits `order.line_adjusted`). A decrease is a short close (see `closed`). Correction of price = cancel (if clean) or close + new PO | validator + DB trigger mirroring `orva_ap_bills` guard | 409 `frozen` |
| ordered_qty / received_qty / billed_amount | Per line: ordered from the line; received = Σ `orva_purchasing_receipts.quantity`; billed = Σ `bill_links.amount` (ex-VAT) | receipts, bill_links | — |
| Over-receipt (A4) | `received_qty + new > ordered_qty` | receipt route | 409 `over_receipt`, nothing written (WMS not called) |
| Price variance | Per line: `billed_amount − (ordered_qty × unit_price)`, shown once `billed_amount > 0`; per PO: Σ line variances. Received-vs-ordered is a separate quantity flag (⚠ on the line), not part of the variance | computed, not stored | Warning badge; never blocks (A3) |
| Committed, not billed | Σ over `sent`/`partially_received`/`received` POs of `(ordered × price) − billed`, ex-VAT; `closed` and `cancelled` excluded | `GET /api/orva_purchasing/summary` (needs bill links → Phase A4 depends on A3) | Shown as "ผูกพันแล้ว ยังไม่มีบิล" on the money panel |
| Late line | `expected_on < today` and `received_qty < ordered_qty` on a non-cancelled, non-closed PO | summary query | Row on the waiting card |
| ใบส่งของ | A non-tax sheet listing the invoice's lines with quantities (prices optional), delivery block, receiver signature. Heading `ใบส่งของ / Delivery Note`; number `DN-<invoice number>` (same convention as `BN-`/`ST-`) | `orva_documents` builder | — |
| Delivery facts | `metadata.delivery = { deliveredOn?, receiverName?, carrier?, trackingNumbers?: string[], address?, showPrices: boolean }` on the invoice | `sales_invoices.metadata` | Missing → sheet prints blanks for hand-writing |

## 📝 Users, Permissions, and Scope

| Actor | Allowed outcomes | Scope rule | Required feature IDs |
|---|---|---|---|
| Owner / admin | everything below | organization | `orva_purchasing.*`, `orva_documents.*`, `orva_finance.ap.*`, `orva_stock.*` |
| Purchasing (staff) | list/view POs; create/edit/send/cancel; receive | organization | `orva_purchasing.view`, `orva_purchasing.manage`, `orva_purchasing.receive` (+ `orva_stock.manage`, `wms.receive_inventory` for goods) |
| Accounting | create bill from PO; link an existing bill to a PO | organization | `orva_purchasing.view`, `orva_purchasing.bill` (dependsOn view) + `orva_finance.ap.manage` |
| Sales | print delivery note; record delivery facts | organization | `orva_documents.view` (print), `sales.invoices.manage` (facts, installed feature) |
| Customer (portal) | open a shared delivery note link | token-scoped | none (same `orva_documents/api/public/[token]` rail) |

`tenantId` from `getAuthFromRequest`; `organizationId` from `resolveActiveOrganizationId(auth)` with `organizationScopeRequiredResponse()` when absent — identical to every `orva_*` route. All DB work inside `withTenantRls(em, tenantId, fn)`. No system-scope operation.

## 📝 Reuse and Ownership Map

| Capability | Reuse / extend / app-own | Existing module or new module | Integration seam | Why |
|---|---|---|---|---|
| Vendor | reuse | `orva_party` (`role = 'vendor'`) | scalar `vendor_party_id` + display-name snapshot on the PO | already the AP vendor model |
| Product line | reuse | `catalog` variants | scalar `catalog_variant_id` + name/sku snapshot | same as `orva_stock` |
| PO record, lines, receipts, bill links, settings | **app-own** | **`orva_purchasing`** (new) | — | the new invariant |
| Bill from PO | reuse | `orva_finance` `POST /api/orva_finance/ap/bills` | internal API call (`callInternal`, as in `orva_stock/lib/internal.ts`) | one write path for bills |
| Stock receipt | reuse + additive | `orva_stock` `POST /api/orva_stock/receive` (+ optional `referenceType`, `referenceId`) → `wms.inventory.receive` | internal API call | one writer of lot costs |
| ใบสั่งซื้อ sheet, PDF, email, public link, sends log | extend | `orva_documents` (`purchase_order` type) | optional DI `orvaPurchasingDocumentSource` registered by purchasing `di.ts`, resolved softly in `orva_documents/lib/purchasingBridge.ts` (named for its sibling `orvaFinanceBridge`) | documents stays independent |
| ใบส่งของ sheet | extend | `orva_documents` (`delivery_note` type from `invoice`) | existing invoice reader | rails exist |
| Delivery facts | reuse | `sales` invoices `metadata` via installed `sales.invoices.update` command | command + optimistic lock | additive, audited |
| Home waiting card / money panel | extend | `orva_finance/api/home/overview` | optional DI `purchasingSummary` (degrades to absent rows) | finance must not import purchasing |
| Numbering | app-own | `orva_purchasing_settings.next_po_seq` | — | A5 |
| Notifications (late lines) | reuse | `notifications` types declared in purchasing `notifications.ts` | daily worker | same shape as `orva_finance.overdue_scan` |

Installed sources of truth that remain: `orva_party` for who the vendor is; `catalog` for the product; `wms` for quantities and lots; `orva_finance` for money; `sales` for the invoice.

## 📝 Architecture and Data Flow

```text
/backend/purchasing/orders/create ─▶ POST /api/orva_purchasing/orders ─▶ orva_purchasing_orders(+lines)
/backend/purchasing/orders/[id]  ─▶ POST …/orders/[id]/send   ─▶ status sent, PO number claimed
                                 ─▶ documents preview?type=purchase_order&documentId=<po> ─▶ PDF / email (orva_documents_sends)
                                 ─▶ GET  …/orders/[id]/bill-draft ─▶ prefill → /backend/ap/bills/create?poId=… (finance creates the bill)
                                 ─▶ POST …/orders/[id]/bill { billId, allocations } ─▶ orva_purchasing_bill_links(po_line ↔ bill_line, amount)
                                 ─▶ POST …/orders/[id]/receive ─▶ goods: callInternal POST /api/orva_stock/receive
                                                                        (referenceType 'po', referenceId <po>) ─▶ wms + orva_stock_lot_costs
                                                                ─▶ service: no call
                                                                ─▶ orva_purchasing_receipts(po_line, movement_id?, qty)
                                                                ─▶ recompute status (partially_received / received)
GET /api/orva_finance/home/overview ─▶ optional DI purchasingSummary ─▶ committed-not-billed, late lines
worker orva_purchasing.late_scan (daily 06:30) ─▶ notification 'orva_purchasing.line_late' (idempotent per line+day)

/backend/sales/invoices row ─▶ "ใบส่งของ" ─▶ documents preview?type=delivery_note&documentId=<invoice>
                           ─▶ "บันทึกการส่งของ" dialog ─▶ sales.invoices.update (metadata.delivery, If-Match updatedAt)
```

- **Module boundaries:** `orva_purchasing` owns the commitment and every link *to* money and stock; `orva_finance` owns the liability; `orva_stock`/`wms` own quantity and cost; `orva_documents` owns the sheet; `sales` owns the invoice. Purchasing is the only module that knows all four — by design it is deletable: dropping it removes no column anywhere else.
- **Extension points:** optional DI tokens (`purchasingDocumentSource`, `purchasingSummary`) registered in `orva_purchasing/di.ts`, resolved softly in `orva_documents` and `orva_finance` (same technique as `orva_documents/lib/financeBridge.ts`); `RowActions` on the invoices list (app-owned page, direct edit); page metadata for nav; notifications registry.
- **Alternatives considered:** events (`orva_purchasing.order.received` → finance) instead of DI for the home figures — rejected because the home screen needs a *read*, not a side effect. A single "receive" that also creates the bill — rejected: the bill often arrives days after the goods.
- **Compatibility:** `POST /api/orva_stock/receive` gains two **optional** fields; response unchanged. `DOCUMENT_TYPES` gains two values (additive; `typesForSourceKind` for `'invoice'` grows by one). No installed contract changes. `sales_invoices.metadata` gains a `delivery` key (additive JSON).

## 📝 User Journeys

### Journey J-001 — Order a Marventine batch from the OEM (REQ-001, 002)

1. Owner opens **คลัง → ใบสั่งซื้อ** (`/backend/purchasing/orders`) → "สร้างใบสั่งซื้อ".
2. Picks vendor (party picker, vendors only), adds line: variant "Marventine Lotion 200ml", qty 500, unit price 85.00, VAT 7%, expected 2026-10-15, account 1200 สินค้าคงเหลือ. Adds a service line "ค่าขนส่ง" 1,500, account 5300. Saves as draft (no number yet, preview shows `PO-202609-####`).
3. "ส่งให้ผู้ขาย" → status `sent`, number `PO-202609-0001` claimed, sheet opens in preview; "ส่งอีเมล" mails the PDF to the vendor party's email and logs an `orva_documents_sends` row.
4. Failure: vendor party has no `vendor` role → 400 at create with a link to the party. Concurrent edit → 409 shown by the shared conflict UI, form keeps input. Try to edit qty on a `sent` PO → fields disabled with reason "ส่งแล้ว — ยกเลิกแล้วออกใบใหม่".

### Journey J-002 — Goods arrive before the bill (REQ-004, 005)

1. Waiting card shows "ของที่สั่งแล้วยังไม่ได้รับ · 1 รายการ เกินกำหนด 3 วัน" → click → PO detail.
2. "รับของ" → dialog lists goods lines with ordered/received; owner enters 480, lot `MRV-2610-A`, MFG/EXP; unit cost prefilled 85.00 from the line (editable). Submit → `orva_stock` receive → WMS lot + cost; receipt row; line shows 480/500; PO `partially_received`.
3. Later the remaining 20 arrive → same dialog → 500/500 → `received`. Entering 30 → 409 "รับเกินจำนวนที่สั่ง (เหลือ 20)"; nothing written.
4. Failure: `orva_stock` has no warehouse configured → the 400 from receive is surfaced verbatim with a link to stock settings; nothing is written on either side (the internal call runs first; purchasing writes only after a 2xx). The reverse failure — stock received, then purchasing's own flush fails — leaves a WMS movement stamped `reference_type='po', reference_id=<po>` with no receipt row; the PO detail shows "มีการรับของที่ยังไม่ผูก" and `orva_purchasing reconcile` re-creates the receipt row from the movement idempotently (TEST-012).

### Journey J-003 — The OEM bill comes in (REQ-003)

1. PO detail → "ออกบิลจากใบสั่งซื้อ" → the existing bill create form (`BillCreateForm`, `?poId=`) opens **pre-filled** from `GET …/orders/[id]/bill-draft`: vendor (read-only), lines with accounts and ex-VAT amounts for *not-yet-billed* quantities, VAT computed per line mode, and the PO/line mapping kept in form state.
2. Owner adjusts freight to 1,800 (vendor charged more), saves → the bill is created by finance exactly as any bill; on success the form calls `POST …/orders/[id]/bill { billId, allocations }` and purchasing writes `bill_links`. PO shows billed 44,300 / PO 44,000, variance +300 (warning badge, A3).
3. Failure: bill create fails (period closed) → the finance 4xx is surfaced; nothing is linked because nothing exists. Bill created but the link call fails (network) → the bill exists unlinked; the PO detail's "ผูกบิลที่มีอยู่" action lists the vendor's unlinked bills and repeats the same idempotent link call (TEST-013).

### Journey J-004 — Deliver and get it signed (REQ-006, 007)

1. Invoices list → row → "ใบส่งของ" → preview opens `type=delivery_note`. Header: ใบส่งของ / Delivery Note, `DN-KKG-INV-2026012`, buyer, delivery address (from invoice `shippingAddress` snapshot → billing address → blank line). Lines: description, qty, unit; prices hidden by default. Footer: ผู้ส่งของ / ผู้รับของ signature boxes with วันที่.
2. Row → "บันทึกการส่งของ" → dialog: ส่งเมื่อ (date), ผู้รับ, ขนส่ง (free text), เลขพัสดุ (chips), ☐ แสดงราคา. Save → `sales.invoices.update` with `If-Match` header from `updatedAt`. Reprint shows the facts.
3. Public link/email: same as other types (`orva_documents/api/share`, `/send`), `orva_documents_sends` logged.
4. Failure: invoice edited elsewhere → 409 → conflict dialog offers reload. Invoice has zero goods lines (pure service) → the action still prints (services are "delivered" too); no hard block.

## 📝 UI and Interaction Contracts

| Surface / route | Purpose and primary actions | Data source / mutations | Closest installed reference | Canonical shell / components | Required states | Requirement IDs |
|---|---|---|---|---|---|---|
| `/backend/purchasing/orders` | list POs: filters status/vendor/late; add | `GET /api/orva_purchasing/orders` — **hand-written guarded route, not `makeCrudRoute`** (exception, rationale below) | `orva_finance/components/BillsTable.tsx` (DataTable) + `orva_support/components/TicketsPage.tsx` (custom list route) | `Page`, `PageBody`, `DataTable`, `RowActions`, `StatusBadge` | loading, empty ("ยังไม่มีใบสั่งซื้อ" + create), error, filter-no-results, permission denied | REQ-001, 002 |
| `/backend/purchasing/orders/create` | create draft PO with lines | `POST /api/orva_purchasing/orders` | `orva_finance/components/BillCreateForm.tsx` (vendor picker, line editor) | header fields + line editor built on `Page`/`Input`/`Button` primitives, **not `CrudForm`** (exception, rationale below); a draft is edited by the same component mounted on the detail page, so there is no separate edit route | validation, server error keeps input, success → detail | REQ-001 |
| `/backend/purchasing/orders/[id]` | detail: header, lines with ordered/received/billed/variance, actions send/cancel/close/receive/bill/print/email | `GET …/orders/[id]`, `POST …/send`, `…/cancel`, `…/close`, `…/receive`, `…/bill-draft` | `orva_support` ticket detail (`backend/support/tickets/[id]`) for header+actions layout | `Page`, `SectionHeader`, `DataTable` (lines), `Dialog` (receive), `StatusBadge`, `useConfirmDialog` (cancel) | loading, error, conflict (409 → shared record-conflict UI), frozen-with-reason, over-receipt error inline | REQ-002, 003, 004 |
| `/backend/documents/preview?type=purchase_order&documentId=<po>` | print/PDF/email ใบสั่งซื้อ | existing preview route; new type | existing preview page | existing | existing + "โมดูลจัดซื้อไม่พร้อม" when DI absent | REQ-001 |
| `/backend/settings/purchasing` (settings context, navHidden) | number format, default accounts | `GET/PUT /api/orva_purchasing/settings` | `orva_stock/backend/…/settings` pattern (`pageContext: 'settings'`) | `CrudForm` | loading, error, success | REQ-001 |
| `/backend` home (waiting card, money panel) | late lines row; committed-not-billed figure | `GET /api/orva_finance/home/overview` (+ optional fields) | existing `FourQuestions` | existing | rows absent when purchasing DI missing | REQ-005 |
| `/backend/sales/invoices` (app-owned page) | row actions "ใบส่งของ", "บันทึกการส่งของ" | preview link; `sales.invoices.update` via installed `PUT /api/sales/invoices` | the page itself (`orva_documents/backend/sales/invoices/page.tsx`) | `RowActions`, `Dialog`, `FormField` | dialog validation, 409 conflict, success flash | REQ-006, 007 |
| `/backend/documents/preview?type=delivery_note&documentId=<invoice>` | print/PDF/email ใบส่งของ | existing route; new type | existing | existing | existing | REQ-006 |

**Two recorded exceptions to the canonical-primitive rule** (both required by this section):

1. **The order list is a hand-written guarded route rather than `makeCrudRoute`.** The columns that make the list worth opening — late-line count now, received quantity and billed amount from A2/A3 — are aggregates over a child table, which the factory's `fields` list (query-index columns of one entity) cannot express. `orva_support` tickets and `orva_tasking` tasks are the same shape and made the same call. Everything else the factory would have given is still there: per-method `metadata` with features, a Zod query schema, tenant/organization scope from the trusted context, RLS, and an `openApi` document. The response feeds a `DataTable` with the generated `entityId` (`orva_purchasing:purchase_order`), so column extensions and perspectives still host.
2. **The create/edit surface is a hand-built header-plus-lines editor rather than `CrudForm`.** `CrudForm` owns whole-record field layout; this screen is one header and a repeating line row carrying three cross-record references, a per-line VAT mode and running totals that move as the operator types. `BillCreateForm` in `orva_finance` is the in-repo precedent for exactly this shape. The shell, inputs, buttons, dialogs, flash messages and states remain platform primitives.


### UI architecture

| Role | Navigation groups in order | Dashboard / injected widgets | Login-to-primary-task flow |
|---|---|---|---|
| Owner | คลัง → ใบสั่งซื้อ (pageOrder 30, between รับสินค้าเข้าคลัง 20 and สินค้าคงเหลือ 40); Settings → จัดซื้อ | home waiting card row → PO detail | home → waiting row → PO → รับของ (3 clicks) |
| Sales | งานขาย → ใบแจ้งหนี้ (existing) | — | invoices → row → ใบส่งของ (2 clicks) |

| Surface / widget | Empty state guidance and action | Responsive behavior | Keyboard / focus behavior |
|---|---|---|---|
| PO list | "ยังไม่มีใบสั่งซื้อ — สั่งของจากผู้ขายครั้งแรกได้จากปุ่มด้านขวา" + create | table collapses to stacked rows; filters wrap | table focus order; Enter opens row |
| PO detail lines | never empty (≥1 line enforced) | lines table scrolls horizontally inside its container | receive dialog: Cmd/Ctrl+Enter submit, Esc cancel; first field focused |
| Delivery dialog | blanks allowed (hand-written on paper) | single column | same dialog contract; tracking chips removable by Backspace |

### `/backend/purchasing/orders/[id]` — ใบสั่งซื้อ detail

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ PO-202609-0001 · ส่งแล้ว          [พิมพ์] [ส่งอีเมล] [รับของ] [ออกบิล] [ยกเลิก ▾]│
│ ผู้ขาย: บจก. โอเอ็ม คอสเมติกส์   วันที่สั่ง 8 ก.ย. 2569   คาดว่าได้รับ 15 ต.ค. 2569 │
├──────────────────────────────────────────────────────────────────────────────┤
│ รายการ            สั่ง     รับแล้ว   ราคา/หน่วย   มูลค่า     บิลแล้ว   ผลต่าง   │
│ Lotion 200ml      500     480 ⚠    85.00      42,500.00  42,500.00   0.00    │
│ ค่าขนส่ง (บริการ)   1       1       1,500.00   1,500.00   1,800.00  +300 ⚠   │
├──────────────────────────────────────────────────────────────────────────────┤
│ รวมก่อน VAT 44,000.00 · VAT 3,080.00 · รวม 47,080.00 · บิลแล้ว 44,300.00        │
│ การรับของ: 12 ต.ค. 480 ชิ้น ล็อต MRV-2610-A (movement …) · บิล: BILL-000012      │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Behavior:** actions gated by status (send only from draft; receive/bill only when sent+; cancel only with no receipts/links → else disabled with reason). Receive dialog validates remaining qty client-side and trusts the server 409. Every mutation sends `updatedAt`; 409 → shared conflict UI with reload.
- **Responsive and accessibility:** header actions collapse into a menu under 640px; lines table scrolls in its own container; all icon buttons labelled; status announced via `StatusBadge` text, not colour alone.
- **Localization:** namespace `orva_purchasing.*` in `src/modules/orva_purchasing/i18n/{th,en}.json` (+ de/es/ko/pl copies of en per repo convention); document headings in `orva_documents/lib/document.ts` HEADINGS (`purchase_order`, `delivery_note`) as th/en pairs like the others. Lesson `i18n-fallbacks-hide-missing-catalog-keys` applies: audit th/en parity in a test.
- **Design-system and theming:** semantic tokens only; `StatusBadge` for status; variance badge uses the shared warning token. Verify light/dark and 375px.

### `/backend/sales/invoices` — delivery dialog (addition to the existing page)

```text
┌ บันทึกการส่งของ · KKG-INV-2026012 ─────────────────────┐
│ ส่งเมื่อ [2026-09-08]   ผู้รับ [__________________]        │
│ ขนส่ง  [Flash Express ▾/free text]  เลขพัสดุ [TH123…] [+] │
│ ☐ แสดงราคาบนใบส่งของ                                     │
│                                   [ยกเลิก] [บันทึก ⌘⏎]   │
└──────────────────────────────────────────────────────────┘
```

- **Behavior:** prefilled from `metadata.delivery`; save issues the installed invoice update with `If-Match`; 409 → conflict UI. Preview link uses the current facts immediately after save (query invalidation of the invoices list).

## 📝 Data Models

### `orva_purchasing_settings`

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | UUID | pk | no | — |
| `tenant_id`, `organization_id` | UUID, required | unique together | no | trusted context |
| `po_number_format` | text, default `PO-{yyyy}{mm}-{seq:4}` | — | no | tokens `{yyyy}{yy}{mm}{seq:n}` |
| `po_seq_period` | text null | — | no | the `{yyyy}{mm}` (or `{yyyy}`) key the counter belongs to; when the format's period token renders differently at send time, the counter resets to 1 |
| `next_po_seq` | bigint, default 1 | — | no | advanced under `select … for update` on the settings row at send time only |
| `default_goods_account_id` | UUID null | — | no | GL account (1200 default) |
| `default_service_account_id` | UUID null | — | no | GL account |
| `vat_default` | text `none`/`7`, default `7` | — | no | — |
| `created_at`, `updated_at` | timestamps | optimistic lock | no | — |

### `orva_purchasing_orders`

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | UUID | pk | no | — |
| `tenant_id`, `organization_id` | UUID, required | composite index; unique `(organization_id, po_number)` where not null | no | trusted context |
| `po_number` | text null | unique per org | no | null while draft; claimed at `send` |
| `status` | text, default `draft` | index `(organization_id, status)` | no | see transitions |
| `vendor_party_id` | UUID, required | index | no | party must hold active `vendor` role (validated at create/update while draft) |
| `vendor_snapshot` | jsonb | — | **yes — contains name/tax id/address of a company; encrypted via `encryption.ts` map like `customer_snapshot` in sales** | frozen at `send` |
| `order_date` | date, required | — | no | — |
| `expected_on` | date null | — | no | header default for lines |
| `currency_code` | text default `THB` | — | no | THB only in v1 |
| `subtotal`, `tax_amount`, `total_amount` | numeric(18,4) | — | no | recomputed from lines on every draft save |
| `memo`, `vendor_reference` | text null | — | no | — |
| `sent_at`, `closed_at`, `cancelled_at` | timestamptz null | — | no | set by transitions |
| `close_reason` | text null | — | no | required on `close`/`cancel` |
| `created_by`, `created_at`, `updated_at`, `deleted_at` | — | `updated_at` = lock version | no | soft delete only while `draft` |

### `orva_purchasing_order_lines`

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id` | UUID | pk | no | — |
| `tenant_id`, `organization_id`, `order_id` | UUID | index `(order_id)`, FK to orders within module | no | — |
| `line_no` | int | unique `(order_id, line_no)` | no | — |
| `kind` | text `goods`/`service` | — | no | `goods` requires `catalog_variant_id` |
| `catalog_variant_id` | UUID null | index | no | scalar into catalog |
| `description`, `sku` | text | — | no | snapshot of variant name/sku or free text |
| `quantity` | numeric(16,4) > 0 | — | no | after send: increase only, via `adjust-quantity` |
| `short_qty` | numeric(16,4) null | — | no | set at `close` = ordered − received; null while open |
| `unit` | text null | — | no | e.g. ขวด, ชิ้น |
| `unit_price` | numeric(18,4) ≥ 0 ex-VAT | — | no | frozen after send |
| `vat_mode` | text `none`/`7` | — | no | frozen after send |
| `account_id` | UUID | — | no | GL account for the bill line |
| `expected_on` | date null | index for late scan | no | editable always |
| `created_at`, `updated_at`, `deleted_at` | — | — | no | — |

### `orva_purchasing_receipts`

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id`, `tenant_id`, `organization_id` | UUID | composite index | no | — |
| `order_id`, `order_line_id` | UUID | index each; FK within module | no | — |
| `quantity` | numeric(16,4) > 0 | — | no | Σ per line ≤ ordered (checked in route under row lock; DB trigger mirrors) |
| `received_on` | date | — | no | — |
| `movement_id` | UUID null | **unique where not null** (reconcile idempotency) | no | WMS movement for goods; null for service |
| `lot_id` | UUID null | — | no | from `orva_stock` receive result |
| `unit_cost` | numeric(18,4) null | — | no | what was passed to stock |
| `memo`, `created_by`, `created_at` | — | — | no | append-only (no update/delete; a wrong receipt is reversed by a WMS adjust + a negative-free "reversal" receipt — **v1: no reversal UI; documented rollback via CLI**) |

### `orva_purchasing_bill_links`

| Field | Type / nullability | Scope / index | Sensitive / encrypted | Lifecycle and validation |
|---|---|---|---|---|
| `id`, `tenant_id`, `organization_id` | UUID | composite index | no | — |
| `order_id`, `order_line_id` | UUID | index | no | FK within module |
| `bill_id`, `bill_line_id` | UUID | unique `(bill_line_id)` | no | scalar into `orva_finance`; a bill line links to at most one PO line |
| `amount` | numeric(18,4) ex-VAT | — | no | what the bill line charged for this PO line |
| `created_at` | — | — | no | append-only; deleting a *draft* bill (finance) leaves a dangling link → the summary query joins `orva_ap_bills.deleted_at is null` and ignores it |

Every table: `select orva_apply_rls();` at the end of the migration (CLAUDE.md rule). Real FKs only within the module. Migration generated with `yarn db:generate`, reviewed, snapshot updated; **applied only after asking**.

### `orva_stock` receive request (additive)

`receiveSchema` gains `referenceType: z.enum(['po','bill','manual']).optional()` and `referenceId: z.string().uuid().optional()`; when present they replace today's derived `referenceType: billId ? 'po' : 'manual'`. Response unchanged.

### `sales_invoices.metadata.delivery` (Track B, additive JSON)

```json
{ "delivery": { "deliveredOn": "2026-09-08", "receiverName": "คุณสมชาย", "carrier": "Flash Express",
                "trackingNumbers": ["TH1234567890"], "address": "…", "showPrices": false } }
```
Validated by `deliveryFactsSchema` in `orva_documents/data/validators.ts`; written through the installed invoice update command; read by the documents source reader.

## 📝 API, Command, and Error Contracts

| Method / command | Path / ID | Auth and feature gate | Input | Success response / event | Errors and concurrency | Requirement IDs |
|---|---|---|---|---|---|---|
| `GET` | `/api/orva_purchasing/orders` | `orva_purchasing.view` | `makeCrudRoute` list: `status[]`, `vendorPartyId`, `late=1`, `search`, paging | `{ items(+updatedAt, vendorName, receivedPct, billedAmount), totalCount }` | 400/401/403 | REQ-001 |
| `POST` | `/api/orva_purchasing/orders` | `orva_purchasing.manage` | header + `lines[]` (≥1) | 201 `{ id }` + `orva_purchasing.order.created` | 400 (vendor lacks role, goods w/o variant) | REQ-001 |
| `PUT` | `/api/orva_purchasing/orders` | `orva_purchasing.manage` | `{ id, updatedAt, …draft fields }` or `{ id, updatedAt, expectedOn/memo }` when sent | `{ ok, updatedAt }` + `order.updated` | 409 `conflict` / `frozen` | REQ-002 |
| `DELETE` | `/api/orva_purchasing/orders?id=` | `orva_purchasing.manage` | id | `{ ok }` (soft) | 409 `not_draft` | REQ-002 |
| `GET` | `/api/orva_purchasing/orders/[id]` | `orva_purchasing.view` | — | header, lines with `orderedQty/receivedQty/billedAmount/variance`, receipts, billLinks, `updatedAt` | 404 | REQ-002–004 |
| `POST` | `/api/orva_purchasing/orders/[id]/send` | `orva_purchasing.manage` | `{ updatedAt }` | `{ ok, poNumber, updatedAt }` + `order.sent` | 409 `invalid_transition`/`conflict` | REQ-002 |
| `POST` | `…/[id]/cancel`, `…/[id]/close` | `orva_purchasing.manage` | `{ updatedAt, reason }` | `{ ok, status, shortQty[] }` + `order.cancelled`/`order.closed` | 409 (`has_receipts`, `has_bills`, `invalid_transition`, `conflict`) | REQ-002 |
| `POST` | `…/[id]/receive` | `orva_purchasing.receive` (+ goods: `orva_stock.manage`, `wms.receive_inventory`, enforced by the internal call with the caller's own cookies) | `{ updatedAt, receivedOn, lines: [{ lineId, quantity, lotNumber?, manufacturedOn?, expiresOn?, unitCost?, memo? }] }` | `{ ok, receipts[], status, updatedAt }` + `order.received` | 409 `over_receipt` / `closed` / `invalid_transition` / `conflict` (nothing written in any case), 400 `lot_required` / `nothing_to_receive`, stock's own 400 surfaced verbatim | REQ-004 |
| `POST` | `…/[id]/reconcile` | `orva_purchasing.receive` | — (no version: it writes down what the warehouse already did) | `{ ok, repaired, status, updatedAt }` + `order.repaired` when > 0 | 409 `closed` | REQ-004 |
| `GET` | `…/[id]/bill-draft` | `orva_purchasing.view` + `orva_finance.ap.view` | — | prefill for `BillCreateForm`: vendor, `poId`, lines (unbilled ex-VAT amounts, accounts, vat, `lineId` per row) | 404, 409 `closed` | REQ-003 |
| `POST` | `…/[id]/bill` | `orva_purchasing.bill` + `orva_finance.ap.view` | `{ updatedAt, billId, allocations: [{ lineId, **billLineNo**, amount }] }` — the bill already exists | `{ ok, linked, alreadyLinked, updatedAt }` + `order.billed` when anything was written | 400 `vendor_mismatch` / `amount_exceeds_bill_line` / `duplicate_allocation`; 404 `bill_not_found` / `line_not_found` / `bill_line_not_found`; 409 `already_linked` / `closed` / `invalid_transition` / `conflict`; an identical re-send answers 200 having written nothing | REQ-003 |
| `GET` | `…/[id]/unlinked-bills` | `orva_purchasing.view` + `orva_finance.ap.view` | — | vendor's bills with unlinked lines | — | REQ-003 |
| `POST` | `…/[id]/lines/[lineId]/adjust-quantity` | `orva_purchasing.manage` | `{ updatedAt, quantity (> current), reason }` | `{ ok, updatedAt }` + `order.line_adjusted` | 400 (not an increase), 409 `closed`/`conflict` | REQ-002, 004 |
| `GET` | `/api/orva_purchasing/summary` | `orva_purchasing.view` | — | `{ committedNotBilled, lateLines: [{orderId, poNumber, description, remainingQty, expectedOn, daysLate}] }` | — | REQ-005 |
| `GET/PUT` | `/api/orva_purchasing/settings` | `orva_purchasing.view` / `.manage` | settings body | row + `updatedAt` | 409 | REQ-001 |
| `POST` (additive) | `/api/orva_stock/receive` | unchanged | + `referenceType?`, `referenceId?` | unchanged | unchanged | REQ-004 |
| `GET` (extended) | `/api/orva_documents/preview` | unchanged | `type=purchase_order&documentId=<po>` / `type=delivery_note&documentId=<invoice>` | sheet | 400 `type_unavailable` when purchasing DI absent | REQ-001, 006 |
| `PUT` (installed) | `/api/sales/invoices` via `sales.invoices.update` | `sales.invoices.manage` | `{ id, metadata: { …existing, delivery } }` + `If-Match` | installed response | 409 installed | REQ-007 |

`orders` list/create/update/delete use `makeCrudRoute` with commands `orva_purchasing.orders.{create,update,delete}`; the action routes are guarded command routes (`send`, `cancel`, `close`, `receive`, `bill`) with `withAtomicFlush(..., { transaction: true })`, optimistic lock on the order's `updatedAt`, and post-commit event emission. The one internal call (`orva_stock` receive) is HTTP-internal and therefore **not** in purchasing's transaction: purchasing calls first and writes its receipt rows only after a 2xx, so a stock failure writes nothing anywhere, while a purchasing failure after a successful receive leaves an orphan the data can find — the WMS movement carries `reference_type='po'`, `reference_id=<po>`, and `metadata.poLineId` (passed through `orva_stock`'s existing `metadata` field). `orva_purchasing reconcile` (CLI, also run by the PO detail's "ซ่อมการรับของ" button) lists such movements without a receipt row and inserts the missing rows idempotently (keyed by `movement_id`, unique). Bills need no reconcile: they are created by finance and linked afterwards by an idempotent call the UI can repeat. Every route: per-method `metadata` + `openApi`.

## 📝 Events, Jobs, Notifications, and Cross-Module Flows

| Trigger | Producer | Consumer | Side effect | Retry / idempotency / audit behavior |
|---|---|---|---|---|
| `orva_purchasing.order.{created,updated,sent,received,billed,closed,cancelled}` | `orva_purchasing` (`events.ts`, `createModuleEvents`) | none required in v1 (available to `orva_time`-style seams, audit) | — | emitted post-commit |
| daily `orva_purchasing.late_scan` 06:30 Asia/Bangkok | `workers/late-scan.ts` (scheduler, same shape as `orva_finance.overdue_scan`) | `notifications` type `orva_purchasing.line_late` | one notification per late line per day | idempotent key `(lineId, date)`; failure → admin notification, no retry storm |
| optional DI `purchasingSummary` | `orva_purchasing/di.ts` | `orva_finance/api/home/overview` | waiting rows + committed figure | soft resolve; absent → rows omitted |
| optional DI `purchasingDocumentSource` | `orva_purchasing/di.ts` | `orva_documents/lib/source.ts` | `purchase_order` sheet | absent → 400 `type_unavailable` |
| `sales.invoice.updated` (installed) | `sales` | existing subscribers | — | delivery facts ride the installed update; nothing new |

Cache: the home overview already caches per org; purchasing summary invalidates on every order/receipt/link write (post-commit).

## 📝 Security, Privacy, and Compliance

- **Authorization:** features `orva_purchasing.view`, `.manage` (dependsOn view), `.receive` (dependsOn view), `.approve` (declared, ungranted — A2). Goods receipt additionally requires the existing `orva_stock.manage` + `wms.receive_inventory`; billing requires `orva_finance.ap.manage`. Granted in `setup.ts` `defaultRoleFeatures` to admin/owner; `yarn mercato auth sync-role-acls` noted in rollout.
- **Tenant isolation:** all queries in `withTenantRls`; `orva_apply_rls()` on the five tables; `verify-rls.mjs` extended with a purchasing probe.
- **Sensitive data:** `vendor_snapshot` (company name, tax id, address, contact) encrypted through `encryption.ts` `defaultEncryptionMaps` like sales' `customer_snapshot`; read with the decryption find helpers (lesson: raw SQL on encrypted columns leaks ciphertext — the summary query selects ids and joins `orva_parties.display_name` live instead of reading the snapshot). Delivery facts contain a receiver's name (third-party PII). Whether `sales_invoices.metadata` is inside sales' encryption map is **Q-004**, resolved as the first step of Phase B1 by reading `.ai/guides/modules/sales/encryption.md`: if it is encrypted, `receiverName` is stored there; if not, `receiverName` is **not stored** (the sheet leaves the line blank for a handwritten name) and only non-personal facts (date, carrier, tracking, address, showPrices) are kept. The decision is recorded in this spec's changelog and asserted by TEST-009.
- **Abuse and failure modes:** PO numbers claimed under row lock (no duplicates under concurrency); over-receipt enforced server-side under `select … for update` on the line; internal calls carry the caller's auth (no privilege widening); public delivery-note links reuse the token rail with its rate limit; no free-text is rendered unescaped in the sheet (existing renderer escapes).

## 📝 Integration Coverage

| Test ID | Level | Setup / fixture | Actions | Assertions | Requirement IDs |
|---|---|---|---|---|---|
| TEST-001 | unit | lines fixture | `computeTotals`, `formatPoNumber`, `deriveStatus(received, ordered)` | totals ex/in VAT per mode; `PO-202609-0001`; `partially_received`/`received` | REQ-001, 002 |
| TEST-002 | integration | org, vendor party, variant, GL accounts | create → PUT → send → PUT qty | 201; number null then claimed once; qty edit after send → 409 `frozen`; stale `updatedAt` → 409 | REQ-001, 002 |
| TEST-003 | integration | sent PO (goods 500 + service) with warehouse configured | receive 480 → receive 30 → receive 20 | 200 + WMS movement + lot cost with `referenceId=po`; 409 `over_receipt` and no rows; 200 → status `received` | REQ-004 |
| TEST-004 | integration | sent PO | `bill-draft` → `bill` with freight 1,800 | bill exists via finance route; links per line; variance +300; second `bill` bills only remaining | REQ-003 |
| TEST-005 | security | second tenant / user without `orva_purchasing.view` | read PO, receive | 404/403; RLS probe returns 0 rows cross-tenant | all |
| TEST-006 | integration | late line (expected yesterday) | `GET summary`; run `late_scan` twice | line listed with `daysLate=1`; one notification, not two | REQ-005 |
| TEST-007 | integration | purchasing DI present / absent | preview `type=purchase_order` | sheet with heading ใบสั่งซื้อ; 400 `type_unavailable` when absent | REQ-001 |
| TEST-008 | unit | invoice source + delivery facts | `buildPrintableDocument('delivery_note')` | number `DN-…`, no prices when `showPrices=false`, delivery block present, not a tax document (no buyer tax id required) | REQ-006 |
| TEST-009 | integration | invoice | PUT metadata.delivery with `If-Match`; stale → | 200 then 409; preview reflects facts; other metadata keys (`quoteId`) preserved | REQ-007 |
| TEST-010 | UI | 3 POs incl. one late, one frozen | list filters; detail actions gating; receive dialog keyboard (⌘⏎/Esc); 375px; dark | correct rows; disabled-with-reason; dialog contract; no horizontal page scroll | REQ-002, 004 |
| TEST-011 | unit | i18n (Track A) | th/en key parity for `orva_purchasing.*` and the `purchase_order` heading | equal key sets | localization |
| TEST-012 | integration | sent PO; stock receive succeeds, purchasing flush forced to throw | receive → error; run `reconcile` twice | WMS movement exists with `reference_id=po`; after reconcile exactly one receipt row; second run inserts nothing; status `partially_received` | REQ-004 |
| TEST-013 | integration | sent PO; bill created via finance route, link call not made | `unlinked-bills` → `bill` twice with same allocations; then link the same bill line to another PO | bill listed; one link set; second call 200 idempotent; other PO → 409 `already_linked` | REQ-003 |
| TEST-014 | unit | i18n (Track B) | th/en parity for `orva_documents.delivery.*` keys and the `delivery_note` heading | equal key sets | localization |
| TEST-015 | integration | sent PO, 480 of 500 received | `close` with reason → `receive` 20 → `summary` | `short_qty=20`, status closed; receive → 409 `closed`; PO absent from late lines and committed figure | REQ-002, 005 |

## 📋 Phasing

Track A phases A1→A4 are dependency-ordered; Track B phases B1→B2 are independent of Track A and may run in parallel with it (different owners possible: A = purchasing module, B = documents).

| Phase | Outcome | Depends on |
|---|---|---|
| **A1 — The order exists** | module, settings, orders+lines CRUD, lifecycle, ใบสั่งซื้อ sheet + email | none |
| **A2 — Goods against the order** | receive route (goods via stock, service direct), over-receipt, status derivation, `referenceId` on stock receive | A1 |
| **A3 — Bill against the order** | bill-draft + bill, links, variance, reconcile CLI | A1 (A2 optional for received-qty variance) |
| **A4 — The owner sees it without opening the module** ✅ | summary DI, home rows, late scan notification | A2 and A3 |
| **B1 — ใบส่งของ prints** | `delivery_note` type from invoice, headings, sample, row action | none |
| **B2 — Delivery facts recorded** | dialog + metadata write + sheet reads them; public link/email verified | B1 |
| B3 (design only, A7) | stock issue on delivery for B2B goods invoices | Marventine launch spec |

## 📋 Implementation Plan

### Phase A1 — The order exists (REQ-001, REQ-002) — ✅ SHIPPED 2026-09-08 (migration applied)

**What shipped**, beyond the deliverables below:

- The lifecycle is enforced twice: in the routes, and by two database triggers
  (`orva_purchasing_line_guard`, `orva_purchasing_order_guard`) that refuse a
  frozen line edit, a falling quantity, a rewritten PO number and a settled
  order coming back to life. A guard that lives only in a route stops being a
  guarantee the moment a CLI or a fix-up script writes the table.
- `partyTitles` was added to `PrintableDocument` (and filled in by
  `partyTitlesFor`): a ใบสั่งซื้อ is the one outgoing sheet where this company is
  the buyer, and the templates had ผู้ขาย / ลูกค้า hard-coded over the two party
  blocks. The structural fields keep their names — `seller` is always the
  issuer — and only the printed titles vary, so no template knows which
  document it is drawing.
- Numbering resets by period: the counter row is locked `for update` at send
  time and the stored period key is compared against the one the format
  implies for the order's own date, so `PO-{yyyy}{mm}-{seq:4}` restarts every
  month while `PO-{seq:5}` never does. 15 unit tests cover the arithmetic,
  the formats and every lifecycle transition.
- Gates: `yarn generate`, `yarn typecheck`, `yarn lint`, `yarn ds:check` and
  `yarn test` (374 tests, 40 suites) all pass. The generated entity id came
  back as `orva_purchasing:purchase_order`, matching what the encryption map
  and the `DataTable` host had assumed.
- **Not yet done:** the migration is written but not applied (`AGENTS.md` asks
  first), so the browser exit gate below is unmet and phase A2 cannot start.

- **Depends on:** none
- **Outcome:** a PO can be drafted, sent (numbered), printed and emailed; frozen after send; cancelled while clean.
- **Why this order / value delivered:** the commitment record is the thing that does not exist; everything else attaches to it. Value: the OEM order for the first Marventine batch can be placed *from Orva* and sits on file.
- **Deliverables:** `src/modules/orva_purchasing/{index.ts, acl.ts, setup.ts, di.ts, events.ts, data/entities.ts, data/validators.ts, lib/{totals.ts, numbering.ts, status.ts}, api/orders/route.ts (makeCrudRoute), api/orders/[id]/route.ts, api/orders/[id]/{send,cancel,close}/route.ts, api/orders/[id]/lines/[lineId]/adjust-quantity/route.ts, api/settings/route.ts, backend/purchasing/orders/{page.tsx,page.meta.ts,create/,[id]/}, backend/settings/purchasing/, components/{PoForm.tsx, PoDetail.tsx}, i18n/*.json, migrations/… (+ `orva_apply_rls()`)}`; `orva_documents`: `purchase_order` in `DOCUMENT_TYPES`, HEADINGS, `typesForSourceKind('purchase_order')`, `templateFor`, `source.ts` branch resolving `purchasingDocumentSource` softly, sample sheet; `src/modules.ts` entry `{ id: 'orva_purchasing', from: '@app' }`; nav order in คลัง group.
- **Independent slices / estimated commits:** (1) entities+migration+ACL+settings; (2) CRUD + lifecycle routes + tests; (3) pages; (4) document type. ~4 commits.
- **Requirements closed:** REQ-001, REQ-002
- **Tests:** TEST-001, TEST-002, TEST-005 (purchasing part), TEST-007, TEST-011, TEST-015 (close semantics; the receive half lands in A2)
- **Validation:** `yarn generate && yarn typecheck && yarn lint && yarn test -- orva_purchasing orva_documents`; `yarn db:generate` reviewed, snapshot updated, **migration applied only after asking**; dev server restarted (lesson: new entity class); `node scripts/verify-rls.mjs`.
- **Exit gate:** in the browser, light and dark, 375px: create → send → number appears → preview → email logged in `orva_documents_sends`; edit qty after send shows disabled-with-reason; a second tab's stale save shows the conflict UI.

### Phase A2 — Goods against the order (REQ-004) — ✅ SHIPPED 2026-09-08

**What shipped**, beyond the deliverables below:

- **The decision is a pure function.** `lib/receivePlan.ts` decides what a
  delivery may record — every line checked before anything moves, so a payload
  with one bad line moves no stock at all — and the route keeps only the
  locking, the stock call and the Thai wording. That is what made the rule
  testable without a database: 10 of the module's 25 unit tests are this file,
  including the case two rows for the same line in one payload used to slip
  through (each measured against the full remainder instead of the running one).
- **The repair path is real, not a promise.** `orva_stock` receives in its own
  database session, so a failure in this module's write afterwards leaves goods
  in the warehouse and the order under-counting. The movement now carries
  `reference_type='po'`, `reference_id` and `metadata.poLineId`, and
  `findOrphanReceipts` joins WMS, purchasing and stock costs to find exactly
  those. Two ways to fix it: `POST …/reconcile` behind the "ซ่อมการรับของ"
  button that appears on the detail page when the count is non-zero, and
  `mercato orva_purchasing reconcile --tenant --org [--dry-run]` for a
  scheduled sweep. Both idempotent — the unique index on `movement_id` is what
  guarantees it, not care on the caller's part.
- **A receipt is append-only at the database.** A third trigger refuses any
  edit to quantity, line, movement or date; a wrong receipt is reversed, not
  rewritten.
- **The three places that reported zero now report receipts:** the detail
  page's received/remaining columns, the list's late-line count (a line is late
  only if less arrived than was ordered), and the close route's per-line
  shortfall.
- **Additive on `orva_stock`, as designed:** `referenceType`, `referenceId` and
  `poLineId` are optional on its receive contract; absent, that route behaves
  exactly as before, deriving `'po'` from a bill id.
- Gates: `yarn generate`, `yarn typecheck`, `yarn lint` (0 errors), `yarn
  ds:check` (716 files) and `yarn test` (384 tests, 41 suites) pass. Migration
  applied after a rolled-back dry run; RLS forced on the new table; all ten
  hand-written SQL statements executed against the real schema with dummy
  parameters inside a rolled-back transaction, including the four-table orphan
  join.
- **Verified 2026-09-08** by the repository's first integration suite,
  `src/modules/orva_purchasing/__integration__/purchase-orders.spec.ts`: six
  specs against a **production build** of the app on an ephemeral database,
  through the real HTTP routes. They close TEST-002 (draft editable, send
  numbers and freezes, stale version conflicts), TEST-003 (partial receive,
  over-receipt refused with nothing written), TEST-015 (short close records the
  shortfall and blocks further receipts) and TEST-005 (a party without the
  vendor role is refused), plus the quantity-adjust rule and the ใบสั่งซื้อ
  sheet rendering with its party blocks the right way round. Every purchasing
  route passed on first contact; the five failed attempts before that were all
  environment, and are recorded in `.ai/lessons.md` →
  `ephemeral-integration-env-gotchas`.
- **Still not walked in a browser by a human.** The API paths are covered; the
  screens are not. The owner's tenant also still has no party holding the
  vendor role, so the create form cannot be completed there until one exists.
  TEST-010 (UI states, keyboard, narrow width) and TEST-012 (the reconcile
  repair) remain unwritten.

- **Depends on:** A1 exit gate
- **Outcome:** receiving is done *from the PO*; the WMS movement and lot cost reference the PO; over-receipt impossible.
- **Why this order / value delivered:** supersedes G3.2 with a better anchor; the Marventine dry-run (G3.1) can now run PO → receive → valuation.
- **Deliverables:** `api/orders/[id]/receive/route.ts`, `api/orders/[id]/reconcile/route.ts`; `orva_purchasing_receipts` (+ append-only trigger); `lib/receivePlan.ts`, `lib/receipts.ts`, `lib/internal.ts`; `orva_stock/data/validators.ts` `referenceType`/`referenceId`/`poLineId` (+ route pass-through into the movement's metadata); `components/ReceiveDialog.tsx`; receipt history and repair banner on the detail page; `cli.ts` `orva_purchasing reconcile`.
- **Independent slices / estimated commits:** (1) stock additive fields + test; (2) receive route + status + tests; (3) dialog. ~3 commits.
- **Requirements closed:** REQ-004
- **Tests:** unit coverage of `receivePlan` (10 cases) plus the integration suite above, which closes TEST-003 and TEST-015 for the service path. TEST-012 (reconcile) and the goods path through WMS remain unwritten: they need a catalog variant and a warehouse in the ephemeral fixture.
- **Validation:** as A1 plus `yarn test -- orva_stock`.
- **Exit gate:** met at the API level — 8 of 10 received, 3 more refused with `over_receipt` and nothing written, a short close recording 2 outstanding, further receipts refused with `closed`. The goods half (a WMS movement carrying the PO id, valuation showing the lot) is still unproven: the ephemeral fixture has no catalog variant or warehouse yet.

### Phase A3 — Bill against the order (REQ-003) — ✅ SHIPPED 2026-09-08

**What shipped**, and the one contract change:

- **A bill line is named by POSITION, not by id.** The spec said
  `allocations: [{ lineId, billLineId, amount }]`; the AP create route writes
  its lines in payload order as `lineNo` 1..n and returns only the bill id, so
  a caller cannot know a `billLineId` without a second round trip it has no
  reason to make. The contract is now `billLineNo` and this route resolves it.
  Everything else about the two-step design stands: finance creates the bill,
  purchasing links it, and no half-written liability is possible.
- **Idempotent by data, not by care.** `bill_line_id` is unique among live
  rows, so a repeat of the same allocation writes nothing and answers 200 —
  which is what lets a client that lost the response retry. An allocation that
  contradicts an existing one (same bill line, different ordered line or
  amount) is refused with `already_linked`, so one charge can never answer two
  commitments. Ten unit tests hold that rule; two integration specs prove it
  through the routes.
- **Over-billing warns and never blocks** (A3, owner-confirmed): the freight
  line billed at 1,800 against 1,500 ordered shows `variance: 300` and links
  anyway.
- **`bill-draft` offers only the unbilled remainder**, so a second bill for the
  same order cannot bill it twice. A fully billed order offers no lines at all,
  and a draft or settled order refuses the prefill outright.
- **The recovery surface is real**: `GET …/unlinked-bills` lists this vendor's
  bills with an unallocated line, and the detail page's "ผูกบิลที่มีอยู่"
  dialog pairs each bill line with an ordered line, defaulting the pairing by
  GL account. The bill form, when opened as `?poId=…`, links automatically
  after finance saves the bill; if that second call fails it says the bill is
  saved and correct and points at the dialog, rather than implying the bill
  failed and inviting a duplicate.
- **Verified** by TEST-004 (link, variance, second draft empty), TEST-013
  (idempotent retry, and a bill line refused to a second order), plus specs for
  the vendor mismatch, an amount above the bill line, and the draft-order
  refusal. 17 integration specs and 395 unit tests pass; `verify-rls` covers
  282 tables.
- **Not done here:** A4's committed-not-billed figure, which needs these links
  and now has them.

- **Depends on:** A1 exit gate (A2 for received-qty variance)
- **Outcome:** the OEM bill is created pre-filled from the PO and linked per line; variance visible.
- **Why this order / value delivered:** closes the three-way match; the accountant's month pack now has bills that trace to orders.
- **Deliverables:** `api/orders/[id]/bill-draft/route.ts`, `api/orders/[id]/bill/route.ts` (link existing bill), `api/orders/[id]/unlinked-bills/route.ts`, `orva_purchasing_bill_links`, `BillCreateForm` accepts `?poId=` prefill (read-only vendor when prefilled; calls the link route after the bill is created and shows a retry banner if that call fails), "ผูกบิลที่มีอยู่" action on the PO detail, variance columns, ACL feature `orva_purchasing.bill`.
- **Independent slices / estimated commits:** (1) routes + links + tests; (2) form prefill; (3) reconcile CLI. ~3 commits.
- **Requirements closed:** REQ-003
- **Tests:** TEST-004, TEST-013 (both shipped as integration specs), plus 10 unit tests of `planBillLinks` and three further route specs.
- **Validation:** as A1 plus `yarn test -- orva_finance` and `yarn test:integration:ephemeral`.
- **Exit gate:** met at the API level — a bill created through the finance route links to the order, the order reports billed 44,300 against 44,000 ordered with +300 on the freight line, a second prefill offers nothing, and re-sending the same allocation writes nothing while a second order is refused the same charge. The screens themselves have still not been walked by a human.

### Phase A4 — The owner sees it without opening the module (REQ-005) — ✅ SHIPPED 2026-09-08

- **Depends on:** A2 and A3 exit gates (the committed figure subtracts bill links)
- **Outcome:** late lines on the waiting card; committed-not-billed on the money panel; daily notification.
- **Why this order / value delivered:** the operating-model principle "one screen a day".
- **Deliverables:** `api/summary/route.ts`, `di.ts` `purchasingSummary`, `orva_finance/api/home/overview` soft resolve + two fields, `FourQuestions.tsx` rows, `workers/late-scan.ts`, `notifications.ts`, scheduler registration.
- **Independent slices / estimated commits:** (1) summary + DI + home; (2) worker + notification. ~2 commits.
- **Requirements closed:** REQ-005
- **Tests:** TEST-006 (shipped as two integration specs), plus 6 unit tests of the notification cadence. TEST-010 remains **unwritten** — no purchasing screen has been walked by a human or a browser yet, in A4 or in any earlier phase.
- **Validation:** `yarn typecheck`, `yarn lint`, `yarn ds:check`, `yarn test` (401 tests / 44 suites), `yarn test:integration:ephemeral` (19 specs against a production build on a throwaway database).
- **Exit gate:** met at the API level. A backdated `expected_on` on a **sent** order appears in `GET /api/orva_purchasing/summary` with `daysLate` and a remaining quantity, and the same line reaches `GET /api/orva_finance/home/overview` as `waiting.latePurchaseLines` through the optional DI seam — the owner sees it without opening purchasing. Linking a bill drops `committedNotBilled` by the billed amount while the line **stays** late; receiving it in full clears the lateness however overdue the date; `close` removes it from both.

**Decisions taken during A4:**

- **A draft is never late.** Lateness needs `status in ('sent','partially_received')`: an unsent order promises nothing, so an old `expected_on` on a draft is the owner's own backlog, not a vendor's failure. Asserted in TEST-006 before the send.
- **Late and unbilled are separate facts and the card must not conflate them.** A line can be billed and still not delivered (the vendor invoiced on despatch); it then leaves the committed figure and stays on the late list. Both halves are asserted in the same spec.
- **The committed figure is floored per line, not per order:** `Σ greatest(0, net − billed)`. Over-billing one line (A3 warns and allows it) must not create a negative that silently pays for another line's shortfall, which a per-order floor would do.
- **The cadence is unit-tested, not integration-tested.** `shouldNotifyToday` speaks on day 1, day 3, then weekly — six notifications for a line a month late, not thirty — and the group key `orva_purchasing.line_late:{lineId}:{date}` makes a re-run, a retry or a manual `mercato scheduler run` idempotent. A queue handler cannot be invoked over HTTP, so the ephemeral harness cannot reach the worker; the arithmetic that decides whether it speaks is covered by 6 pure tests instead, and the worker itself is a thin loop over `purchasingSummary` + `lateLinesToNotify`.
- **The scan raises and contacts nobody.** 06:30 Asia/Bangkok, ahead of the invoice scan at 07:00 and the morning brief at 07:30 so the brief can already see what it raised. Chasing a vendor is a judgement call about a relationship; the same reasoning the overdue-invoice scan uses.

### Phase B1 — ใบส่งของ prints (REQ-006)

- **Depends on:** none
- **Outcome:** any invoice prints/PDFs/emails as a delivery note.
- **Why this order / value delivered:** the missing statutory-practice sheet, zero schema.
- **Deliverables:** Q-004 resolved first (read `.ai/guides/modules/sales/encryption.md`, record the `receiverName` decision in the changelog); `orva_documents/lib/document.ts` (`delivery_note` type, heading, `DeliveryBlock` type, `showPrices` handling, non-tax classification), `source.ts` (number `DN-`, read `metadata.delivery`, address fallback chain), `templateFor` mapping to `templateInvoice`, sample sheet, row action on `backend/sales/invoices/page.tsx`, i18n keys, e-mail subject template in `emails/`.
- **Independent slices / estimated commits:** (1) builder + tests; (2) source + row action + email. ~2 commits.
- **Requirements closed:** REQ-006
- **Tests:** TEST-008, TEST-014
- **Validation:** `yarn test -- orva_documents`; browser preview in light/dark; PDF via the existing endpoint.
- **Exit gate:** ใบส่งของ renders for a real invoice with prices hidden, signature boxes present, public link opens, email logged.

### Phase B2 — Delivery facts recorded (REQ-007)

- **Depends on:** B1 exit gate
- **Outcome:** delivery facts are captured once and printed every time.
- **Why this order / value delivered:** turns the sheet from a blank form into a record of the delivery date (the VAT point for goods).
- **Deliverables:** `deliveryFactsSchema` in `orva_documents/data/validators.ts`, `DeliveryFactsDialog.tsx`, row action, installed invoice update call with `If-Match` via the shared helpers, query invalidation; encryption check noted in Security.
- **Independent slices / estimated commits:** 1–2.
- **Requirements closed:** REQ-007
- **Tests:** TEST-009, TEST-010 (dialog keyboard)
- **Validation:** as B1.
- **Exit gate:** save facts, reprint shows them; stale second tab gets the conflict UI; `metadata.quoteId` survives the write.

## 📝 Requirement Traceability

| Requirement | Journey / surface | Data/API/event contracts | Phase | Tests | Acceptance criterion |
|---|---|---|---|---|---|
| REQ-001 | J-001, `/backend/purchasing/orders(/create)`, preview `purchase_order` | orders, lines, settings; `POST/GET /api/orva_purchasing/orders`; `order.created`; `purchasingDocumentSource` | A1 | TEST-001, 002, 007, 011 | AC-001 |
| REQ-002 (close/adjust) | J-002, PO detail | `close`, `adjust-quantity`; `short_qty`; `order.closed`, `order.line_adjusted` | A1 | TEST-015 | AC-002 |
| REQ-002 | J-001, `/backend/purchasing/orders/[id]` | `PUT`, `send`, `cancel`, `close`; `order.sent/cancelled/closed`; frozen guard | A1 | TEST-002, 010 | AC-002 |
| REQ-003 | J-003 | `bill-draft`, `unlinked-bills`, `bill` (link existing); `orva_purchasing_bill_links`; `order.billed` | A3 | TEST-004, 013 | AC-003 |
| REQ-004 | J-002 | `receive`; `orva_purchasing_receipts`; `orva_stock` receive `referenceType/Id` + `metadata.poLineId`; `reconcile`; `order.received` | A2 | TEST-003, 010, 012 | AC-004 |
| REQ-005 | J-002 step 1, `/backend` | `summary`; `purchasingSummary` DI; `late_scan`; `orva_purchasing.line_late` | A4 | TEST-006, 010 | AC-005 |
| REQ-006 | J-004, preview `delivery_note` | `DOCUMENT_TYPES` + heading; `DN-` numbering | B1 | TEST-008, 014 | AC-006 |
| REQ-007 | J-004 step 2, `/backend/sales/invoices` | `metadata.delivery` via `sales.invoices.update` | B2 | TEST-009, 010 | AC-007 |

Extension-surface rows (per `.ai/guides/spec-delivery.md`): new module registration (`src/modules.ts`, adapts `src/modules/example/index.ts`, A1, TEST-002, emitted-example); ACL features (`example/acl.ts`, A1, TEST-005, emitted-example); events (`example/events.ts`, A1, TEST-002, emitted-example); DI registrations (`example/di.ts`, A1/A4, TEST-007/006, emitted-example); worker (`example/workers/*.ts`, A4, TEST-006, emitted-example); notifications (`example/notifications.ts`, A4, TEST-006, emitted-example); CLI (`example/cli.ts`, A2, TEST-012, emitted-example); backend pages (`example/backend/**/page.tsx`, A1, TEST-010, emitted-example); encryption map (`example/encryption.ts`, A1, TEST-002 asserts ciphertext at rest, emitted-example). Exact file rows are confirmed against `src/modules/example/references/surface-inventory.json` at A1 start.

## 📝 Rollout, Migration, and Rollback

- **Migration:** one migration per module change, ending in `select orva_apply_rls();`; generated with `yarn db:generate`, applied only after the owner's go (`AGENTS.md`). `orva_stock` and `orva_documents` need no schema change. Dev server restart after new entity classes (lesson).
- **Setup:** `setup.ts` seeds `orva_purchasing_settings` per org idempotently (`seedDefaults`), grants features to admin; `yarn mercato auth sync-role-acls` for the existing tenant.
- **Feature flag:** none needed; the module is a registry line. Removing `{ id: 'orva_purchasing' }` from `src/modules.ts` removes routes, nav, worker, DI — documents and home degrade to "type unavailable"/rows omitted by design; tables remain (data preserved).
- **Observability:** `createLogger('orva_purchasing')`; the reconcile CLI doubles as a health check (should print zero unlinked rows).
- **Rollback:** A1–A4 are additive; rollback = unregister the module **and** run the corrective migration that drops the two purchasing triggers (over-receipt, frozen-after-send) — tables and rows stay. WMS movements stamped `reference_type='po'` keep their ids; the movements screen renders the reference as text, so nothing breaks, the link just stops resolving. `orva_stock` additive fields are optional; reverting the route keeps old behaviour. B1/B2: **do not remove the type once a delivery note has been shared or emailed** — public tokens and `orva_documents_sends` rows point at it; rollback is hiding the row actions (no new links) while the type stays renderable. `metadata.delivery` stays as inert JSON.
- **Supersession bookkeeping:** benchmark row "Purchase order to OEM" → this spec; roadmap G3.2 → replaced by A2 (`expected_on` lives on PO lines). Both files get a one-line pointer in the same commit as this spec.

## 📝 Risks and Tradeoffs

| Risk / tradeoff | Impact | Mitigation / detection | Residual risk |
|---|---|---|---|
| Stock receive succeeds but purchasing's own flush fails | WMS movement + lot cost with no receipt row; PO under-reports received | movement carries `reference_type='po'`, `reference_id`, `metadata.poLineId`; `reconcile` (CLI + detail button) inserts the missing receipt idempotently (`movement_id` unique); TEST-012 injects the failure | window between failure and reconcile; surfaced on the PO as "มีการรับของที่ยังไม่ผูก" |
| Bill created but the link call never happens | PO under-reports billed | bills are never created by purchasing, so no half-state; "ผูกบิลที่มีอยู่" repeats the idempotent link; TEST-013 | none material |
| Two users receive the same line concurrently | over-receipt | `select … for update` on the line + DB trigger | none material |
| `vendor_snapshot` read via raw SQL returns ciphertext | wrong vendor names on lists | list joins `orva_parties.display_name` live; snapshot used only by the sheet through decryption helpers; lesson recorded | display name changes after send differ from the printed sheet — acceptable, it is a snapshot by intent |
| A7: delivery note printed but stock not issued for a B2B goods invoice | on-hand overstated | non-goal stated on the sheet action tooltip; Marventine launch spec owns it; ⚠ A8 | real until that spec |
| Owner never creates POs for small buys | metrics look bad, no harm | "ออกบิลโดยไม่มีใบสั่งซื้อ" remains allowed; the bill form offers "สร้าง PO ย้อนหลัง?" only as a link, no nag | accepted |
| Numbering collision under concurrency | duplicate PO numbers | claim under `for update` on settings row; unique index | none |
| Documents module grows another type | builder complexity | type-driven branches already exist for 10 types; unit tests per type | maintainability, accepted |

## ✅ Acceptance Criteria

- [ ] **AC-001** — An owner in org X drafts a PO with a goods and a service line, sends it, and the sheet prints/emails with number `PO-YYYYMM-####`; a user in org Y cannot read it (404) and the RLS probe returns 0 rows.
- [ ] **AC-002** — After send, editing price/account/vendor returns 409 `frozen` and the UI shows the disabled reason; quantity can only be increased, with a reason; cancel is refused (409) once a receipt or bill link exists; `close` records `short_qty` per line and blocks further receipts and links.
- [ ] **AC-003** — A bill created from the PO exists in AP with the PO's accounts, is linked per line, and the PO shows billed amount and variance; billing again offers only unbilled quantities.
- [ ] **AC-004** — Receiving beyond the remaining quantity returns 409 and writes nothing in WMS, stock or purchasing; a valid receipt creates the WMS movement with `reference_id = PO`, a lot cost, a receipt row, and flips status to `partially_received`/`received`; a receipt orphaned by an injected failure is repaired by `reconcile` with exactly one row.
- [ ] **AC-005** — A line past `expected_on` appears on the home waiting card within one page load and produces exactly one notification per day.
- [ ] **AC-006** — An invoice prints as ใบส่งของ with `DN-` number, quantities, signature boxes, prices hidden by default, and is reachable by public link and email like other types.
- [ ] **AC-007** — Delivery facts saved from the invoices list survive a reload, appear on the reprinted note, and a stale save shows the conflict UI without clobbering `metadata.quoteId`.
- [ ] Every listed backend surface matches its recorded Open Mercato reference and uses the canonical shell/components, shared API helpers, semantic tokens, and complete loading, empty, error, conflict, keyboard, accessibility, responsive, light-mode, and dark-mode states.
- [ ] Every affected API and UI path has self-contained integration coverage and the configured validation gate passes. **After A1/A2: the validation gate passes and every API path of the lifecycle has integration coverage. The UI paths do not (TEST-010), and neither does the goods receipt through WMS.**

## 📝 Final Compliance Report

| Check | Status | Evidence / resolution |
|---|---|---|
| Applicable `AGENTS.md` files and routed guides/skills reviewed | pass | `AGENTS.md`, `CLAUDE.md` (RLS rule), `.ai/guides/contracts.md`, `.ai/guides/backend-ui.md`, `.ai/guides/spec-delivery.md`, `om-spec-writing` SKILL + rules, module facts `sales`, `wms`, `shipping_carriers`, lessons catalog |
| Data models, APIs, events, UI, and tests are internally consistent | pass | traceability table; every route has a test id |
| Every workflow completes end to end without a catch-all integration phase | pass | A1–A4, B1–B2 each end in a browser-verifiable gate |
| Platform-native reuse and extension points were chosen before custom code | pass | Reuse map: party, catalog, wms, finance bill route, stock receive route, documents rails, notifications, scheduler, optional DI |
| UI contracts identify references, canonical components, and theme/state coverage | pass | UI table + two mockups; `DataTable`/`CrudForm`/`RowActions`/`StatusBadge`/`Dialog` |
| Every phase has dependencies, bounded slices, tests, value, and an observable exit gate | pass | Implementation Plan |

Verdict: **Ready for implementation.** The owner confirmed A3 and A8 on 2026-09-08, closing Q-001 and Q-002. Q-004 is not an owner decision and not a design unknown: it is a one-file read that Phase B1 performs as its first step, and it changes only whether one optional field (`receiverName`) is stored — both branches are already specified, tested by TEST-009 and reachable from the same B1/B2 plan. Q-003 (whether the OEM accepts our PO template) affects sheet fields only and cannot block the record. Every requirement maps to a phase, a test oracle and an acceptance criterion.

## 📝 Open Questions

| ID | Question | Owner | Blocking? | Resolution / decision date |
|---|---|---|---|---|
| Q-001 | A3 — should over-billing hard-block instead of warn? | owner | no | **resolved 2026-09-08: warn, never block** |
| Q-002 | A8 — one delivery note per invoice is enough until the second Marventine batch? | owner | no | **resolved 2026-09-08: yes, keep the facts in `metadata`** |
| Q-003 | Does the OEM require a PO in their own template (they may not accept ours)? Affects only the sheet's fields | owner | no | pending |
| Q-004 | Is `sales_invoices.metadata` covered by sales' encryption map? Decides whether `receiverName` may be stored (see Security) | implementer, Phase B1 step 1 | no for Track A / B1; resolved before B2 code | pending — read `.ai/guides/modules/sales/encryption.md` as B1's first step |

## 📝 Changelog

| Date | Change |
|---|---|
| 2026-09-08 | Initial draft with autonomous defaults A0–A8 |
| 2026-09-08 | Phase A4 shipped: `GET /api/orva_purchasing/summary`, the `purchasingSummary` DI seam that `orva_finance` soft-resolves, late lines and the committed figure on the home waiting card, the `orva_purchasing.line_late` notification and the 06:30 late scan. Track A closed. Recorded: a draft is never late, late and unbilled are separate facts, the committed figure is floored per line, and the worker's cadence is unit-tested because a queue handler is unreachable over HTTP |
| 2026-09-08 | Phase A3 shipped: bill links, the two-step link with position-named bill lines, the unbilled-remainder prefill, the recovery dialog, and billed/variance on the detail. The allocation contract changed from `billLineId` to `billLineNo`, recorded above |
| 2026-09-08 | First integration suite in the repository: six specs against a production build on an ephemeral database, closing TEST-002/003/005/015. The five environment failures on the way are recorded as a lesson |
| 2026-09-08 | Phase A2 shipped: receipts, the receive route on a pure planner, the reconcile route/CLI/button, append-only receipts, and real received sums in the list, detail and close paths. Integration coverage recorded as an open gap |
| 2026-09-08 | Owner confirmed A3 (warn, never block) and A8 (facts in `metadata`); Q-001 and Q-002 closed; status → Ready for implementation |
| 2026-09-08 | Adversarial fresh-context review applied: bill flow made two-step (finance creates, purchasing links; no orphan possible), reconcile anchored on the WMS movement (`metadata.poLineId`, unique `movement_id`), quantity increase-only after send, `closed` defined with `short_qty`, variance defined against ordered value, A4 now depends on A3, `orva_purchasing.bill` feature for Accounting, TEST-012–015 added, rollback covers triggers and shared tokens, Q-004 owns the PII question, monthly sequence reset defined |
