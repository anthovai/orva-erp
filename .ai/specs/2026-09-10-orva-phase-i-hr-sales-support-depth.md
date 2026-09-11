# Orva Phase I — depth where a department is thin: HR paperwork, sales reuse, customer self-service

**Date**: 2026-09-10
**Status**: In implementation — **I1 and I2 done** (59/59 integration green); I3 and I4 remain. Slice by slice, the owner asked to build rather than review a plan first

> Written after the owner said HR, Sales and Support "ยังไม่ตอบโจทย์" and pointed at
> Horilla HR and Horilla CRM as the yardstick. Companion to
> `2026-09-04-orva-department-benchmark.md` (which Phase H closed for stock and marketing)
> and `2026-09-05-orva-phase-g-roadmap.md`.

## TLDR

Four slices, chosen by the owner from a Horilla comparison: **I1** the Thai statutory
paperwork HR cannot produce today (ภ.ง.ด.1, สปส.1-10, 50 ทวิ for employees) plus the
employee identity those forms need; **I2** reusable service items and a follow-up on a
quote that was sent and never chased; **I3** a customer portal that shows a customer
their own quotes, invoices and payments; **I4** attachments on a support ticket and a
customer who can open one without email.

Everything is built for a **multi-tenant product**, not for Kaiser Klowns: the owner
intends to release Orva as SaaS after trialling it, so rates, registration numbers and
form identity are tenant settings, never constants in code.

## The Horilla comparison, and why no code comes from it

| | Horilla HR | Horilla CRM | Orva today |
|---|---|---|---|
| Licence | LGPL-2.1 (no "or later") | LGPL-2.1+ | MIT posture on Open Mercato (MIT) |
| Stack | Django 5 / Python 3.11+ | Django 5.2 / Python 3.12+ | Next.js / TypeScript |
| Modules | employee, recruitment, onboarding, offboarding, attendance (+biometric, facedetection, geofencing), leave, payroll, pms, asset, helpdesk, project | accounts, contacts, leads, opportunities, campaigns, forecast, activity, calendar, mail, cadences, duplicates, reports | 13 `orva_*` modules on the installed platform |
| Quotes / invoices / tax documents | — | **absent, README says planned** | 13 document types incl. e-Tax, งวด, credit/debit note, statement |

**Verdict: benchmark only, no reuse.** Two independent reasons. (1) LGPL-2.1 is
copyleft: copied source would carry its terms into what Orva ships. (2) It is Django;
there is no path into a Next.js app, and running it beside Orva would stand up a second
employee and contact database next to the ERP's — two sources of truth for the same
person. Feature lists are not copyrightable, so the gap analysis below is fair game.
Same posture as `2026-08-30-orva-mfa-sso-clean-room.md`.

Horilla is also a poor yardstick for two of the three areas: its Helpdesk is an internal
HR desk, not customer support, and its CRM has no billing documents at all.

## Goals

- **REQ-I1a** — An employee record carries the identity Thai filing needs: prefix, first
  and last name, national id (checksum-validated), social-security number, address, bank
  account for the payroll transfer, and a termination date. The sensitive fields are
  encrypted at rest.
- **REQ-I1b** — The employer's own filing registration (social-security employer number
  and branch, the person who signs the return) is a tenant setting beside the existing
  document identity.
- **REQ-I1c** — From a calculated or posted payroll month the system produces **ภ.ง.ด.1**
  (per-employee income and withholding) and **สปส.1-10** (per-employee wage and both
  contributions) on screen and as a spreadsheet the accountant can use, with the totals
  that must match the remittance.
- **REQ-I1d** — Each employee gets a printable **หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ)**
  for a year, marked ภ.ง.ด.1ก with income type 40(1), reusing the certificate sheet the
  vendor side already prints.
- **REQ-I2** — Quote lines come from a reusable service/product list instead of being
  retyped, and a quote that has been sent and not answered surfaces as work to do.
- **REQ-I3** — A signed-in customer sees their own quotes, invoices, payments and
  outstanding balance in the portal.
- **REQ-I4** — A ticket carries attachments (the screenshots clients actually send), and
  a signed-in customer can open a ticket and watch its status.

## Non-goals

Recruitment, onboarding/offboarding workflows, attendance and biometrics, performance
reviews, asset register (Horilla has them; a company with one person on payroll does
not need them, and they are not what the owner picked). Leave entitlements were offered
and **not** selected — upstream `staff_leave_requests` stays as it is. No lead scoring,
cadences, duplicate detection or revenue forecasting: two customers make them theatre.

## Resolved assumptions (autonomous defaults)

| ID | Assumption | Rationale | Flag |
|---|---|---|---|
| A1 | The statutory outputs are an on-screen table + a UTF-8-BOM CSV, **not** the Revenue Department's / SSO's fixed-width upload file | the authoritative record layouts are not in hand, and a wrong byte offset in a tax upload is worse than no upload; the CSV is the same treatment ภ.พ.30 already gets | ⚠ NEEDS HUMAN CONFIRMATION — if the owner or the accountant supplies the official layouts, the file writer is a small addition on top of the same rows |
| A2 | Employee identity lives on `orva_hr_employees`, not as custom fields | it is app-owned domain data every tenant needs, not a per-tenant extension | — |
| A3 | National id, social-security number, address and bank account are encrypted at rest; the display name stays in clear | the name is already the payslip and GL snapshot by design; the other four are the ones that hurt when leaked | — |
| A4 | The 50 ทวิ sheet is shared with `orva_finance` rather than copied | it is the same government form; the vendor version already renders it and even draws the ภ.ง.ด.1ก checkbox | — |
| A5 | Income is reported as type 40(1) เงินเดือน only | the payroll engine pays a monthly salary and nothing else; bonuses and allowances do not exist in the engine yet | ⚠ revisit when pay components are added |
| A6 | Social-security rate and ceiling, and the tax brackets, stay inside the Rust engine | they are the same for every Thai employer and already unit-tested there | — |
| A7 | Filing period = the payroll run's `month_code`; a month with no posted run reports nothing rather than guessing | filings follow money actually paid | — |

## Slices

### I1 — HR statutory paperwork (REQ-I1a…d)
1. `orva_hr_employees` + statutory identity columns; `orva_hr/encryption.ts` for the four sensitive ones; migration.
2. `orva_hr_settings` + employer registration; the existing settings route and the payroll page's inline settings banner carry them.
3. `lib/statutory.ts` — pure: Thai national-id checksum, ภ.ง.ด.1 rows, สปส.1-10 rows, the annual certificate figures. Unit tests.
4. `GET /api/orva_hr/employees/detail` (decrypting read for the form), `GET /api/orva_hr/statutory/pnd1`, `/sso`, `/certificate` — each JSON, the first two also `format=csv`.
5. `/backend/hr/statutory` — month picker, the two returns with totals and a download; year + employee picker for the certificate, which prints through the shared sheet.
6. Integration spec: seed a staff member and an employee with statutory identity, run and post a payroll month, then assert both returns and the certificate against the posted figures.

### I2 — Sales: the quote you already wrote is the template (REQ-I2, first half)
The "ready-made items" half was investigated and **redirected, with the owner's agreement**:
the quote line editor is upstream's `SalesDocumentForm` (1,546 lines) and carries no
injection slot, so a catalogue picker would mean forking that component and re-merging it
forever. What is actually reusable in this business is the last quote, so:
1. `lib/duplicateQuote.ts` — reads a quote (decryption-aware: `customer_snapshot` and
   `comments` are encrypted) and shapes the create payload. Carries customer, contact,
   snapshot, currency, comments and every line; drops number, status, acceptance token
   and dates.
2. `POST /api/orva_documents/duplicate-quote` — creates through upstream's own
   `POST /api/sales/quotes` so the line arithmetic, the custom fields and this module's
   number-claiming interceptor all run once; reads the claimed number back afterwards.
3. Row action on the quote list (injection widget) and on `/backend/projects`.
4. Integration spec `duplicate-quote.spec.ts`.

**Still open from REQ-I2**: the follow-up half (a quote sent and never answered surfacing
as work to do). The send log `orva_documents_sends` already answers "when did I last send
this", which is the seam it would use.

### I3 — Sales: the customer's own portal
### I4 — Support: attachments and customer-opened tickets

(Each is written up when it starts, in this file.)

## Risks

| Risk | Mitigation |
|---|---|
| A filing number is wrong and the owner submits it | every figure is derived from a posted payroll run and shown beside the run's own totals; nothing is typed twice |
| Encrypted columns read as ciphertext through raw SQL | the statutory reads use `findWithDecryption`; the list index deliberately does not carry the four fields (lesson `raw-sql-on-encrypted-columns-leaks-ciphertext`) |
| The CSV is mistaken for an official upload file | the screen says it is for the accountant, and A1 is flagged |

## Changelog

| Date | Change |
|---|---|
| 2026-09-10 | Spec opened. Horilla HR and CRM read and compared; both LGPL-2.1 and Django, so benchmark only. Owner picked I1–I4 and asked to build slice by slice, and set the direction that the system must be SaaS-ready rather than Kaiser-shaped |
| 2026-09-10 | **I1 built.** `orva_hr_employees` gains prefix, Thai given/family name, national id, social-security number, address, bank name and account, and a termination date; the last four sensitive ones are encrypted at rest by the new `orva_hr/encryption.ts`, so the employee edit form now reads through a decrypting detail route (`api/employees/detail`) instead of the query index. `orva_hr_settings` gains the social-security employer account, its branch and who signs the return. `lib/statutory.ts` is pure: the national-id check digit, ภ.ง.ด.1 rows, สปส.1-10 rows and the annual certificate figures, 15 unit tests. Three read routes (`statutory/pnd1`, `statutory/sso`, `statutory/certificate`), the first two also `format=csv` with the BOM Excel needs for Thai. One screen `/backend/hr/statutory` with a month picker, both returns with their totals and the problems that block filing, plus an employee-and-year picker that prints the 50 ทวิ. The certificate sheet was extracted from `orva_finance/components/WhtCertificate.tsx` into `WhtCertificateSheet.tsx` and is now shared by the vendor and the employee versions — one government form, one component |
| 2026-09-10 | **I1 ephemeral green**: 58 passed, 0 failed, with the Rust payroll sidecar running so the whole path was exercised — an employee created with a punctuated national id, refused when the check digit is wrong, read back decrypted through the detail route while the list index still cannot see it, then a November run calculated and posted and all three documents asserted against its figures (65,000 gross → 3,679.17 withheld → 750 each side of social security) and both screens rendered. Two environment notes: the harness needs the payroll sidecar on 127.0.0.1:8701 or the figures half reports itself skipped, and Docker Desktop is now a per-user install so `%LOCALAPPDATA%\Programs\DockerDesktopesourcesin` has to be on PATH for the ephemeral runner |
| 2026-09-10 | **I2 (first half) built and green**: 59 passed. Quote duplication from the list row and the projects page, through upstream's create route. Verified once on the real tenant against KK-QTN-2026011: the copy took KKG-QTN-2026012 with 7 lines and the same 85,600 total, then the test quote was removed and the quote sequence stepped back so the next real quote still takes 2026012. **Demo payroll purged** as far as the module allows: PRUN-0002 and its 5 lines are gone; PRUN-0001 stays because `orva_hr_payroll_run_guard_trg` makes a posted run immutable and that guard was not worked around |
