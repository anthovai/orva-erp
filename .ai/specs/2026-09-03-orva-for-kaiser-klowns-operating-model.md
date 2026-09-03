# Orva for Kaiser Klowns — operating model and design direction

Status: design (2026-09-03), agreed facts from the owner. Tenant #1 = บริษัท ไคเซอร์ ตัวตลก จำกัด.
Principle: build the **"solo service + product business" profile** — Kaiser is the first user of it,
nothing is hard-coded to Kaiser, so the same shape becomes the SaaS offer later.

## The company (facts)

| | |
|---|---|
| People | 1 owner-operator (also holds a day job); AI agents do the repetitive work |
| Today's business | custom software / web-app projects, quoted → billed in % installments, 7% VAT, customers withhold 3% |
| Income | irregular, project-driven → cash visibility matters more than revenue reports |
| Bookkeeping | outsourced to an accounting firm → Orva hands over a monthly pack, it does not file |
| Next business | **Marventine** — lotion (cosmetics): FDA จดแจ้ง numbers, lots/expiry, OEM purchasing, B2C sales via marketplaces/LINE, ใบกำกับภาษีอย่างย่อ |
| Not used | sales orders, WMS operations, staff/teams/leave, resource planning, storefront checkout (until Marventine needs a channel) |

## Design consequences (what "fits the company" means)

1. **One screen a day** — the home answers the owner's four questions: what money is due in (open งวด, overdue), what came in this month, what tax/filing is coming (ภ.พ.30 by the 15th, ภ.ง.ด. by the 7th) and what documents wait (unpaid invoices, quotes about to expire). Everything else is one click away, not on the menu.
2. **Menu = the business, not the framework** — hide upstream pages the profile does not use (orders, channels, WMS, planner, staff/teams/leave). Keep them re-enableable per tenant (`overrides.routes.pages`), so Marventine can switch stock/catalog back on.
3. **Accountant hand-off, not self-filing** — a monthly **ชุดปิดเดือน**: VAT registers + ภ.พ.30 summary, WHT registers, ledger/cash book, P&L + balance sheet + cash flow, bank reconciliation status, and the PDFs of every tax document issued — one zip / one shared link per month. Agents can assemble and send it.
4. **Agents as staff** — the ai_assistant module gets Orva tools: read a transfer slip → propose บันทึกรับชำระ; draft a quote from a brief; assemble the month pack; nag about overdue งวด. The owner approves; agents prepare.
5. **Two brands, one legal entity** — document settings become **brand profiles** (logo, colour, footer, number prefix: KKG-* for Kaiser software, MRV-* for Marventine) chosen per document; seller identity (tax id, address) stays one.
6. **Marventine readiness (later, when the first batch exists)** — products with FDA notification number, lot + expiry, cost per lot; purchasing from the OEM as AP bills with input VAT; B2C receipts (ใบกำกับภาษีอย่างย่อ) and marketplace payout reconciliation; stock valuation into the books.

## Roadmap

| Phase | Deliverable | Why first |
|---|---|---|
| A (now) | Menu trimmed to the profile; home rebuilt around the four questions; quote → งวด → receipt flow already complete | daily use gets simple immediately |
| B | ชุดปิดเดือน export + "send to accountant" (email/link) | removes the biggest recurring chore |
| C | Agent tools on the assistant: slip → receipt, quote drafting, month pack, reminders | the owner is one person |
| D | Brand profiles per document series (Kaiser / Marventine) | needed before the first Marventine document |
| E | Marventine stock/product layer (lots, expiry, FDA no., OEM bills, B2C receipts) | when the product ships |

Out of scope until asked: SaaS packaging (billing, tenant onboarding) — the profile is built reusable, but no seller-side work yet.
