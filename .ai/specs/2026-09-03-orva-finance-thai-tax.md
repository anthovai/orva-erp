# Orva Finance — Thai tax completeness (ภาษีหัก ณ ที่จ่าย, ภาษีซื้อ/ขาย, รายงานสรรพากร)

Status: in progress (2026-09-03). Route: `module-data` + `backend-ui` + `umes` (documents → finance bridge via optional DI).

## Audit (what existed before this spec)

orva_finance shipped GL (accounts, periods, journals, close, trial balance, P&L/BS), AP (bills → expense/AP, payments → AP/cash), AR (post sales invoices → AR/revenue/VAT out, receipts → cash/AR), aging. Gaps found against real Thai SME bookkeeping for บริษัท ไคเซอร์ ตัวตลก จำกัด:

| # | Gap | Consequence |
|---|---|---|
| 1 | Receipts had no withholding — customers withhold 3% of the pre-VAT amount | the real KBank transfer (24,960 on a 25,680 invoice) could not settle the invoice |
| 2 | AP bills had no input VAT; payments had no withholding for vendors | ภ.พ.30 and ภ.ง.ด.3/53 impossible |
| 3 | No reversal journals | the only way to undo a posted entry was a hand-typed mirror; demo entries could not be neutralised cleanly |
| 4 | GL/AR settings unset; COA lacked WHT/VAT-input/bank accounts | AR posting and receipts failed with "not configured" |
| 5 | orva_documents (issue-invoice, record-payment) never reached the ledger | two sources of truth: documents said paid, books said nothing |
| 6 | No tax reports (รายงานภาษีขาย/ซื้อ, ภ.พ.30, ภ.ง.ด.53, หนังสือรับรอง 50 ทวิ), no per-account ledger / cash book | month-end filing done outside the system |
| 7 | No fixed-asset register / depreciation | ทะเบียนทรัพย์สิน outside the system |

## Phases

1. **Schema + posting math** — `Migration20260903120000_thai_tax`: AR settings `wht_receivable_account_id`, `default_cash_account_id`; receipts `wht_amount`, `wht_rate`, `source_invoice_id`; AP settings `input_vat_account_id`, `wht_payable_account_id`; bills `tax_amount`; payments `wht_amount/rate/type/cert_no`; journals `journal_kind='reversal'` + `reversal_of_id` (unique). Builders in `lib/ar.ts`, `lib/ap.ts` take the new amounts; unit tests cover the KBank case (24,960 + 720 = 25,680).
2. **Reversal journals** — `POST api/gl/journals/reverse` mirrors a posted journal into a new posted `reversal` journal on a caller-chosen date in an open period; originals are never edited (DB guards unchanged). Row action on the journals list.
3. **Documents → Finance bridge** — orva_finance registers `orvaFinanceBridge` in DI (optional dependency for orva_documents): `postInvoice()` at issue time and `recordReceipt()` at บันทึกรับชำระ (cash + WHT, allocated to the invoice). Failures surface as a warning on the document side; the document operation itself never rolls back.
4. **Reports** — รายงานภาษีขาย (from posted tax documents), รายงานภาษีซื้อ (bills with tax), ภ.พ.30 summary; ภ.ง.ด.3/53 register + printable หนังสือรับรอง 50 ทวิ per payment; บัญชีแยกประเภท (per-account ledger with running balance) doubling as สมุดเงินสด/ธนาคาร for cash accounts.
5. **Data** — Thai COA additions (1010 เงินสด, 1020 ธนาคารกสิกรไทย 217-2-81503-3, 1300 ภาษีซื้อ, 1400 ภาษีถูกหัก ณ ที่จ่าย, 1500/1590 อุปกรณ์ & ค่าเสื่อมสะสม, 5400–5700 expenses); GL/AR/AP settings; demo journals reversed; KK-INV-2026012 posted and its receipt booked.
6. **Later** — fixed-asset register with monthly depreciation journals; bank statement import/reconciliation; cash-flow statement.

## Contracts

New/changed API surfaces are additive (new optional fields, new routes). `buildReceiptJournalLines`, `buildPaymentJournalLines`, `buildBillJournalLines` gain trailing optional parameters — existing call sites keep working.
