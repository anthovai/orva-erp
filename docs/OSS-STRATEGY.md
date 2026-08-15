# ORVA OSS Strategy

> แนวทางคัดเลือกและประกอบ Open Source เป็น ORVA Modules · สถานะ: Draft · อัปเดตล่าสุด: 2026-08-14
>
> เอกสารเกี่ยวข้อง: [ARCHITECTURE.md](ARCHITECTURE.md) · [MILESTONES.md](MILESTONES.md)

## หลักคิด

ไม่เลือก OSS เพราะ "ฟีเจอร์เยอะ" แต่คัดเป็น **Open Source Building Blocks**:

> แก้ได้เต็มที่ + ใช้เชิงพาณิชย์ได้ + ไม่มีฟีเจอร์สำคัญล็อกหลัง Commercial Edition + เอามารวม/ดัดแปลงได้จริง

ถ้าโมดูลใดไม่มี OSS ตัวเดียวที่ครบ → **ประกอบหลาย OSS เข้าด้วยกันเป็น ORVA Module เดียว** — ผู้ใช้ไม่เห็น OSS ด้านหลัง

```
                    ORVA ERP
             Intelligence Engineered
                       │
                 ORVA Core
                       │
        ┌──────────────┼──────────────┐
        │              │              │
       HRM           Finance        Project
        │              │              │
   ┌────┼────┐    ┌────┼────┐    ┌────┼────┐
  OSS  OSS  OSS  OSS  OSS  OSS  OSS  OSS  OSS
   └────┴────┘    └────┴────┘    └────┴────┘
        │              │              │
        └──────────────┼──────────────┘
                       ▼
                  ORVA MODULE
```

## "Foundation" ไม่ใช่ "Clone"

เป้าหมายไม่ใช่ clone OSS แล้วเปลี่ยนโลโก้ แต่คือ:

> **ORVA HRM is engineered from multiple open-source foundations.**

ทุก OSS ต้องผ่านชั้นของ ORVA ก่อนถึงผู้ใช้:

```
Open Source Foundation
        ↓
ORVA Adapter
        ↓
ORVA Domain Model
        ↓
ORVA Permission
        ↓
ORVA Workflow
        ↓
ORVA UI
        ↓
ORVA Intelligence
        ↓
ORVA Module
```

สมการสุดท้าย:

```
OSS              = Foundation
ORVA Core        = Architecture
ORVA Integration = Glue
ORVA Code        = Our IP
ORVA Intelligence = Differentiator
ORVA ERP         = ผลิตภัณฑ์สุดท้าย
```

## เกณฑ์คัดเลือก OSS

| เกณฑ์ | ระดับ |
|---|---|
| Open Source | ✅ ต้องมี |
| OSI-approved License | ควรเป็น |
| Commercial Use | ✅ ต้องได้ |
| Modify | ✅ ต้องได้ |
| Redistribute | ✅ ต้องได้ |
| Fork | ✅ ต้องได้ |
| ไม่มี Paid Core Features | ต้องการ |
| Self-host | ✅ ต้องได้ |
| Source Code ครบ | ✅ ต้องมี |
| Active Development | ควรมี |
| API | ควรมี |
| Modular | ควรมี |
| Database access | ควรมี |
| Docker | ควรมี |
| Multi-tenant | ถ้ามีจะดีมาก |
| SSO/OIDC | ถ้ามีจะดีมาก |

**ไม่ใช้แค่คำว่า "Open Source" ตัดสิน** — แต่ละ license มีข้อผูกพันต่างกัน

## License Tiers

เป้าหมาย: ORVA เป็น Commercial Product + ปิด source ส่วนที่เขียนเอง → หลีกเลี่ยง copyleft obligation ผูกเข้า Core โดยไม่จำเป็น

### 🟢 Tier A — เหมาะมาก (เอามาแก้ → รวม → Fork → พัฒนาเป็น ORVA)

- MIT
- Apache-2.0
- BSD-2-Clause / BSD-3-Clause

*ยังต้องตรวจ dependency และ NOTICE/attribution ของแต่ละโครงการ*

### 🟡 Tier B — ใช้ได้ แต่ต้องวาง Architecture ให้ถูก

- LGPL, MPL, EPL, CPAL และ license ที่มีเงื่อนไขเฉพาะ

*ไม่ได้แปลว่าใช้ไม่ได้ — ต้องตรวจว่ารูปแบบการรวมกับ ORVA ที่ต้องการทำได้อย่างไร (เช่น process แยก, dynamic linking)*

### 🔴 Tier C — ไม่ใช่ตัวเลือกแรก

- GPL, AGPL, SSPL, BSL
- Source Available ที่ไม่ใช่ OSI Open Source

## วิธีประกอบโมดูล: ตัวอย่าง HRM

คัดจาก license ก่อน feature — แล้วประกอบ + เขียนส่วนที่ขาดเอง:

```
ORVA HRM
│
├── Employee       ← OSS (Tier A)
├── Attendance     ← OSS (Tier A)
├── Leave          ← OSS (Tier A)
├── Recruitment    ← OSS (Tier A อีกตัว)
├── Payroll        ← ORVA เขียนเอง
├── Performance    ← ORVA เขียนเอง
├── Training       ← ORVA เขียนเอง
└── Benefits       ← ORVA เขียนเอง
```

ส่วนที่เขียนเอง = **IP ของ ORVA ที่สะสมเพิ่มขึ้นเรื่อย ๆ**

### HR Candidates จากการค้นเบื้องต้น (ยังไม่ตัดสิน)

| โครงการ | License | ฟีเจอร์ | สถานะการพิจารณา |
|---|---|---|---|
| Frappe HR | GPL-3.0 🔴 | กว้างมาก (Employee → Payroll/Tax) | ไม่เอาเป็นฐานหลัก — copyleft |
| OrangeHRM | GPL-3.0 🔴 | ครบ | ไม่เอาเป็นฐานหลัก — copyleft |
| OpenHRApp | MIT 🟢 | Employee, Attendance, Leave, Performance, Organization, Reports | ตรวจ maturity/ความครบก่อน |
| Genius HRM | MIT (ต้องยืนยัน) 🟢 | 13 modules — lifecycle, payroll, attendance, recruitment, performance | ตรวจ source/dependencies/activity จริงก่อน shortlist |
| Horilla | ต้องตรวจ license ต่อ branch/version | Recruitment, Employee, On/Offboarding, Attendance, Leave | ตรวจ license ให้ชัดก่อนตัดสิน |

## ORVA OSS Component Matrix

ไม่หา "ERP ที่ดีที่สุด" แต่ทำ matrix ระดับ **feature** ต่อ domain:

```
ORVA
├── HRM        → Employee, Recruitment, Onboarding, Attendance, Leave,
│                Payroll, Performance, Training, Benefits
├── Finance    → Accounting, Invoice, Expense, Payment, Budget, Tax
├── Project    → Project, Task, Timesheet, Resource, Reporting
├── Support    → Ticket, SLA, Knowledge Base, Customer Portal
├── Inventory  → Product, ...
└── CRM        → Accounts, Contacts, Leads, Opportunities, Campaigns,
                 Activity/Calendar, Reporting
```

> **CRM เพิ่มเป็น Office ที่ 6** (2026-08-14) — เดิม 5 office (HRM, Finance, Project, Support, Inventory) ยังไม่มี domain ที่ครอบคลุม sales pipeline / lead-to-opportunity โดยตรง ริเริ่มจากการตรวจ candidate `horilla-crm` ด้านล่าง

แต่ละ feature ประเมินตามลำดับ:

```
Feature → OSS Candidate → License → Commercial OK? → Can Modify?
→ Can Redistribute? → Completeness → Maintenance → Security
→ ORVA Integration Cost → DECISION
```

## ผลต่อส่วนที่ตัดสินไปแล้ว

- **ORVA Knowledge**: ใช้**แนวคิด**ของ Obsidian (linked notes / wiki / knowledge graph / markdown-based) เท่านั้น — ตัว Obsidian เป็น proprietary ใช้ไม่ได้ทุกกรณี (ดู [ARCHITECTURE.md §9](ARCHITECTURE.md)) ถ้าจะหา OSS knowledge base มาเป็น foundation ต้องผ่านเกณฑ์ Tier A/B ในเอกสารนี้
- **ORVA Worker**: OpenWorker เป็น MIT 🟢 Tier A — ผ่านเกณฑ์ (ยังต้องตรวจ dependencies)

## Shortlist — ผ่านเกณฑ์เบื้องต้น (รอตัดสินใจใช้จริง)

### Horilla HR / Horilla CRM (`horilla/horilla-hr`, `horilla/horilla-crm`)

ตรวจสอบ 2026-08-14 — ผ่านเกณฑ์ license เบื้องต้น ต่างจาก Odoo/ERPNext ตรงที่ **ไม่มีการแบ่ง Enterprise/Community** ทั้ง org (`horilla-hr`, `horilla-hr-mobile`, `horilla-docs`, `horilla-crm`, `horilla-setup`) เป็น **LGPL-2.1** ทั้งหมด ยืนยันจากไฟล์ LICENSE จริง ไม่ใช่แค่ badge

| รายการ | horilla-hr | horilla-crm |
|---|---|---|
| Domain | HRM | CRM |
| License | LGPL-2.1 → 🟡 Tier B | LGPL-2.1 → 🟡 Tier B |
| Tech stack | Python 3.11+ / Django 5.0+ | Python 3.12+ / Django 5.2+ |
| Docker | ✅ | ✅ |
| Active dev | ✅ (push ล่าสุดวันตรวจ) | ✅ (push ล่าสุดวันตรวจ) |
| Paid/Enterprise feature-lock | ❌ ไม่พบ | ❌ ไม่พบ |
| ฟีเจอร์หลัก | Employee, Recruitment, Onboarding/Offboarding, Attendance, Leave, Payroll, Performance, Asset, Helpdesk | Accounts/Contacts, Leads/Opportunities, Campaigns, Activity/Calendar, Reporting |

**License tier: 🟡 Tier B (LGPL-2.1)** — ไม่ใช่ 🔴 Tier C แบบ ERPNext (GPL-3.0) เพราะ obligation ของ LGPL เกิดเฉพาะเมื่อ**แก้ไขโค้ดของตัว library/codebase นี้เองแล้วแจกจ่ายต่อ** (ต้องปล่อย source ของส่วนที่แก้) ถ้าโค้ด ORVA แค่**เรียกใช้ผ่าน API แยกโปรเซส/service** (ตรงกับสถาปัตยกรรม OSS Foundation → ORVA Adapter ที่วางไว้อยู่แล้ว) โค้ด ORVA เองไม่ต้องเป็น LGPL ไปด้วย

**เงื่อนไขบังคับก่อนใช้จริง:**
1. ห้ามแก้โค้ด Horilla โดยตรงแล้ว merge เข้าโปรเซสเดียวกับ ORVA Core — ต้องรันเป็น service แยก คุยผ่าน API/DB adapter เท่านั้น
2. ถ้าจำเป็นต้องแก้โค้ดในตัว Horilla เอง (patch bug, เพิ่ม field) ส่วนที่แก้ต้องเปิด source กลับตาม LGPL — ไม่กระทบโค้ด ORVA ส่วนอื่น
3. ยังไม่ใช่ Tier A (MIT/Apache) → ต้องมี ADR แยกตอนตัดสินใจใช้จริง อธิบายรูปแบบ deployment แบบแยก service

**สถานะ:** เข้า shortlist ทั้งคู่ (HRM candidate + CRM candidate) — ยังไม่ตัดสินใจใช้จริง รอเปรียบเทียบกับ candidate อื่นตาม [ORVA OSS Component Matrix](#orva-oss-component-matrix) ก่อนล็อก stack

### ผลเทียบ HRM เพิ่มเติม (ตรวจสอบ 2026-08-14) — ยืนยัน Horilla เป็น core module

ค้นเพิ่มอีก 7 โครงการ ตรวจ license จากไฟล์ LICENSE จริงทุกตัว (ไม่เชื่อ badge)

**ผ่านเกณฑ์ license (🟢 Tier A ทั้งหมด) แต่community/ความครบฟีเจอร์เล็กกว่า Horilla มาก:**

| ชื่อ | License | Enterprise-lock | Community | ฟีเจอร์เด่น | ฟีเจอร์ที่ขาด |
|---|---|---|---|---|---|
| ahmed-fawzy99/hr-management-system | MIT | ไม่มี | เล็ก (99★, dev velocity ต่ำ) | Payroll + weighted performance evaluation | Recruitment, Onboarding, Training, Benefits |
| amralsaleeh/HRMS | MIT | ไม่มี | เล็ก (78★) | SMS/WhatsApp notification | Recruitment, Onboarding, Performance, Training, Benefits |
| michaelnjuguna/open-source-hrm | MIT | ไม่มี | เล็ก (32★) | Payroll ผูก compliance เคนยา (ใช้กับไทยต้องเขียนใหม่) | Recruitment, Onboarding, Performance, Benefits |
| phphrm/phphr | MIT | มี **PHPHR Cloud** (managed hosting เสียเงินแยก — ยังไม่พบว่าล็อกฟีเจอร์ แต่ควรเฝ้าดูรูปแบบคล้าย Odoo) | เล็กมาก (6★) เสี่ยง maintainer ทิ้งโปรเจกต์ | — | Recruitment, Onboarding, Performance, Training, Benefits |
| mimnets/OpenHRApp | MIT | ไม่มี | เล็กมาก (13★, เพิ่งเริ่ม) | Attendance แบบ biometric selfie + GPS geofencing (Horilla ยังไม่มี) | Recruitment, Onboarding, **Payroll**, Training, Benefits — และโค้ดเขียนโดย AI ทั้งหมดตามที่ README ระบุเอง (red flag ด้าน quality/security) |

**ตัดออก:**

| ชื่อ | เหตุผล |
|---|---|
| IceHrm | GPL-3.0 🔴 + มี Enterprise/Cloud edition ที่ล็อก Payroll เต็มรูปแบบและ Recruitment/ATS ไว้เฉพาะ Enterprise — รูปแบบเดียวกับ Odoo ที่ตัดไปแล้ว |
| EGroupware | GPL 🔴 + เป็น groupware suite ไม่ใช่ HRM โดยตรง |
| Genius HRM (เคยเสนอว่าเป็น MIT) | หา repo จริงไม่เจอบน GitHub — ตรวจสอบไม่ได้ ตัดออกจนกว่าจะมีคนยืนยัน URL |

**ผลสรุป:** ไม่มีตัวไหนแทน Horilla ได้ทั้งระบบ — ทุกตัวขาดอย่างน้อย 4/9 ฟีเจอร์หลัก (ส่วนใหญ่ขาด Recruitment/Onboarding/Training/Benefits) และ community เล็กกว่า Horilla มาก **→ Horilla ยังเป็น HRM core module ต่อไป** ส่วนโครงการเหล่านี้เก็บไว้เป็น "แหล่งอ้างอิงโค้ด/แนวคิดเฉพาะจุด" ภายใต้ MIT เท่านั้น (ไม่ fork ทั้งระบบ): Attendance geofencing จาก OpenHRApp, Payroll weighted-evaluation จาก hr-management-system, Multi-channel notification จาก amralsaleeh/HRMS

### Finance Candidates (ตรวจสอบ 2026-08-14)

ไม่มี OSS ตัวเดียวครอบคลุมครบ 6 ฟีเจอร์ (Accounting/Invoice/Expense/Payment/Budget/Tax) แบบ Tier A — ต้อง**ประกอบหลายตัว**

**ผ่านเกณฑ์ license (🟢 Tier A) — แยกตามจุดแข็ง:**

| ชื่อ | License | จุดแข็ง | ข้อจำกัด |
|---|---|---|---|
| **Formance Ledger** | MIT | Accounting core — double-entry, multi-currency, programmable (numscript), REST/gRPC API, Docker-native, dev สูงมาก | ไม่มี Invoice/Expense/Budget/Tax เลย, เขียน Go ต้องรันแยก service |
| **TigerBeetle** | Apache-2.0 | Ledger database เฉพาะทาง เร็วสุดระดับ mission-critical | เป็นแค่ primitive ไม่มี business layer, ไม่มี official Rust client |
| **Kill Bill** | Apache-2.0 | Invoice + Payment orchestration, mature 10+ ปีระดับ production, มี tax plugin (Avalara) | ไม่ใช่ full GL, ไม่มี Expense/Budget, Java stack |
| **Actual Budget** | MIT | Budget + Expense/transaction tracking, community ใหญ่มาก (28k★) | ออกแบบสำหรับ personal finance ไม่ใช่ multi-entity business ต้อง adapt data model มาก |
| **SolidInvoice** | MIT | Invoice + Payment แบบเบา | Community เล็ก, PHP/Symfony |
| **GOBL (invopop)** | Apache-2.0 | Tax — tax-rate database + e-invoice schema หลายประเทศ (มีประโยชน์มากสำหรับ e-Tax Invoice ไทย) | เป็น library/schema ไม่ใช่แอป ต้องเขียน UI/logic ห่อเอง |
| **ledger-cli** | BSD-3-Clause | Double-entry algorithm อ้างอิง พิสูจน์แล้ว 20+ ปี | CLI single-user/single-file ไม่มี API/multi-tenant — ใช้เป็น reference ออกแบบ ไม่ integrate ตรง |

**ตัดออก — บทเรียนสำคัญ: license เปลี่ยนกลางทาง**

| ชื่อ | License จริงที่พบ | หมายเหตุ |
|---|---|---|
| Akaunting | **BSL** (ไม่ใช่ MIT ตามที่เคยมีชื่อ) — จำกัดสูงสุด 2 users/1 บริษัท/1,000 invoices | 🔴 แย่กว่า copyleft เพราะจำกัด production use ตรง ๆ |
| Invoice Ninja | **Elastic License 2.0** (ไม่ใช่ MIT ตามที่เคยเข้าใจ) | 🔴 source-available ไม่ใช่ OSI |
| Midaz (LerianStudio) | **Elastic License 2.0** | 🔴 แม้ตลาดพูดว่าคล้าย Apache |
| Firefly III, InvoiceShelf/Crater, Bigcapital, Frappe Books, Lago, Wallos | AGPL-3.0 | 🔴 Tier C |
| hledger | GPL-3.0 | 🔴 |
| beancount | GPL-2.0 | 🔴 |

> **บทเรียน:** โปรเจกต์ invoicing/billing แบบเต็มระบบ (โดยเฉพาะกลุ่ม PHP/Laravel และ billing-SaaS) มักเปลี่ยน license กลางทางจาก permissive → AGPL/BSL/Elastic เพื่อกันคู่แข่ง SaaS — **ต้องเช็คไฟล์ LICENSE จริงทุกครั้ง ห้ามเชื่อชื่อเสียงเก่าของโครงการ**

**คำแนะนำชุดประกอบ ORVA Finance:** Formance Ledger (accounting core) + Kill Bill (invoice/payment) + Actual Budget (budget/expense — ใช้เป็น data model reference) + GOBL (tax) — ทั้งหมด MIT/Apache-2.0 ไม่มี enterprise-lock แต่เป็นงาน integration หนักเพราะ 4 ตัวคนละภาษา (Go/Java/TypeScript/Go-lib) ต้องผ่าน API เข้า Rust core ทั้งหมด — ยังไม่ตัดสินใจใช้จริง

### Project Management Candidates (ตรวจสอบ 2026-08-14)

วงการ PM tool ถูกครองด้วย AGPL/GPL เกือบหมด — ต่างจากฝั่ง ERP ที่ยังพอมี LGPL ให้เลือก

| ชื่อ | License | Enterprise-lock | ฟีเจอร์เด่น/ขาด | สถานะ |
|---|---|---|---|---|
| Plane | **AGPL-3.0** | ไม่มี edition แยก แต่ core ทั้งหมดอยู่ใน AGPL | Project/Task ครบ, ขาด Timesheet, Resource จำกัด | 🔴 ตัด — network-use clause บังคับเปิด source ถ้า host ให้ลูกค้า |
| Taiga (back) | **MPL-2.0** | ไม่มี | Project/Task/Sprint ✅ | 🟡 Tier B — ผ่านถ้าใช้เฉพาะ backend |
| Taiga (front) | AGPL-3.0 | — | — | 🔴 ต้องตัดทิ้ง เขียน UI เอง |
| OpenProject | **GPL-3.0** | **มี** Enterprise Edition แยก (2FA, custom fields ขั้นสูง, Gantt baseline, SSO/LDAP ขั้นสูง) — ฟีเจอร์ครบสุดในกลุ่มแต่ตัดสองเด้ง | ครบสุด: Project/Task/Timesheet/Resource/Reporting | 🔴 ตัด — license + feature-lock ซ้ำ เหมือน ERPNext/Odoo |
| Focalboard | AGPL-3.0/MIT ผสม + ต้องซื้อ commercial license | มี | Kanban เท่านั้น | 🔴 ตัด — **unmaintained** ด้วย |
| Vikunja | AGPL-3.0 | ไม่มี edition แยก แต่มีประวัติดราม่าเรื่องเปลี่ยน license ปี 2021 | Project/Task ดี, ขาด Timesheet/Resource | 🔴 ตัด — license + trust risk |
| Leantime | AGPL-3.0 + exception clause ให้ปลั๊กอิน enterprise แยกได้ | มี ผ่านช่องปลั๊กอิน | Project/Task/Reporting ดี | 🔴 ตัด |

**คำแนะนำ:** ไม่มีตัวไหนผ่าน Tier A/B แบบสมบูรณ์ — ทางเลือกที่สมเหตุสมผลที่สุดคือ **ใช้เฉพาะ Taiga-backend (MPL-2.0, Tier B)** เป็น foundation แล้วตัด taiga-front (AGPL) ทิ้งทั้งหมด ให้ ORVA เขียน UI/Adapter เองคุยผ่าน REST API ของ backend โดยตรง (รันแยก process ตามที่ Tier B ต้องการ) — ยังไม่ตัดสินใจใช้จริง อาจต้องขยายค้นหาเพิ่มถ้าไม่พอ

### Support/Helpdesk Candidates (ตรวจสอบ 2026-08-14)

*(baseline เทียบ: horilla-hr helpdesk module = LGPL-2.1, Tier B, ไม่มี feature-lock — ตรวจไว้แล้วก่อนหน้า)*

| ชื่อ | License | Enterprise-lock | ฟีเจอร์เด่น/ขาด | สถานะ |
|---|---|---|---|---|
| Zammad | **AGPL-3.0** | ไม่มี — ครบทุกฟีเจอร์ใน self-hosted | Ticket/SLA/KB/Portal ครบสุดในกลุ่ม | 🔴 ตัดที่ license แม้ฟีเจอร์ดีที่สุด |
| Chatwoot | Core **MIT** แต่ `enterprise/` แยก commercial license | **มี** — SLA, Custom Roles, SAML/SSO, Assignment V2 ล็อกหลัง Enterprise | Ticket/KB/Portal (core) ดี, **SLA (1 ใน 4 ฟีเจอร์เป้าหมาย) ถูกล็อก** | 🔴 ตัด ถ้าจะใช้ต้องตัดโฟลเดอร์ enterprise/ ทิ้งหมด |
| Tiledesk | **MIT** ทุก repo | ไม่พบ | License สะอาดสุด แต่เป็น chatbot/live-chat ไม่มี SLA/KB/Portal แบบ helpdesk | 🟢 license ผ่านแต่ product ไม่ตรง use case |
| FreeScout | **AGPL-3.0** | **มี** — KB ($12), Customer Portal ($12.99), Workflows ($14.99) ขายแยก | Ticket ดี, KB/Portal ต้องซื้อ | 🔴 ตัดที่ license ซ้ำด้วย open-core lock บน 2/4 ฟีเจอร์เป้าหมาย |
| UVdesk | **OSL-3.0** (network-copyleft คล้าย AGPL) | ไม่ชัดเจน | Ticket/KB/Portal ดี แต่ dev pace ช้าลง (~11 เดือนไม่ push) | 🔴 ตัด |

**คำแนะนำ:** ไม่มี candidate ผ่านทั้ง license-tier และ feature-completeness พร้อมกัน — **horilla-hr helpdesk (LGPL-2.1, Tier B) ยังปลอดภัยกว่ากลุ่มนี้ทั้งหมด** แนะนำใช้เป็นฐานหลักสำหรับ Support ต่อไป ถ้าจะแยก Support เป็นระบบอิสระจริงในอนาคตควรขยายค้นหาเพิ่ม (เช่น osTicket, Peppermint) แทนที่จะเลือกจาก 5 ตัวนี้

### Inventory Candidates (ตรวจสอบ 2026-08-14)

| ชื่อ | License | Enterprise-lock | ฟีเจอร์เด่น/ขาด | สถานะ |
|---|---|---|---|---|
| **InvenTree** | **MIT** | ไม่มี — core 100% เปิด | ครบ: Product/BOM, Stock, **Purchase Order** (auto stock increase), **Sales Order + Auto Allocate (ตัดสต็อกอัตโนมัติ)** | 🟢 **แนะนำ** — active สุด (push วันตรวจพอดี), REST API + Docker ครบ |
| PartKeepr | GPL-3.0 | N/A | เน้น component tracking ไม่มี PO เต็มรูป | 🔴 ตัด — license + **archived** (deprecated) |
| GreaterWMS | Apache-2.0 | ไม่พบ | Stock/Warehouse/PO ผ่าน ASN | 🟡 license ผ่านแต่กำลัง "3.0 reconstruction" ไม่แน่นอน — เก็บเป็น backup |
| ModernWMS | Apache-2.0 | ไม่มี | WMS เต็มรูปแต่ doc ไม่ครบ | 🟡 license ผ่านแต่ momentum ต่ำ (.NET stack ต่างจาก pattern ทีม) — backup |
| OpenBoxes | EPL-1.0 | ไม่พบ | Product/Warehouse/PO/fulfillment ครบ | 🟡 Tier B ใช้ได้ถ้ารันแยก service แต่ stack Groovy/Grails niche |
| Snipe-IT | AGPL-3.0 | N/A | Asset management ไม่ใช่ inventory/warehouse เต็มรูป | 🔴 ตัดที่ license + ไม่ตรง use case |

**คำแนะนำ:** **InvenTree เป็นตัวเลือกที่ชัดเจนที่สุดในทุก domain ที่สำรวจมา** — ผ่าน license (MIT, Tier A) + ไม่มี enterprise-lock + ฟีเจอร์ตรงเป้าหมายครบ 4 ข้อรวมตัดสต็อกอัตโนมัติ + active development สูงสุด + REST API/Docker พร้อมใช้ เหมาะเป็น Foundation ให้ ORVA Adapter คั่นกลางได้ทันที — ยังไม่ตัดสินใจใช้จริง (รอ ADR)

## Decision Log — ตัดออกจาก Shortlist

| โครงการ | License | เหตุผลที่ตัด |
|---|---|---|
| **ERPNext** | GPL-3.0 🔴 Tier C | Copyleft เต็มรูปแบบ — ถ้าต่อยอดใกล้โค้ด ORVA จะถูกบังคับให้ ORVA ส่วนนั้นเป็น GPL ไปด้วย ขัดเป้าหมาย commercial product ที่ปิด source ส่วนของเราเอง ตัดตั้งแต่ขั้น license ไม่ต้องพิจารณาฟีเจอร์ต่อ |
| **Odoo** | Community = LGPL-3.0 🟡 Tier B (ทางเทคนิคยังพอใช้ได้), Enterprise = Proprietary | ไม่ได้ตัดเพราะ license อย่างเดียว — ตัดเพราะ (1) ฟีเจอร์สำคัญจำนวนมากล็อกอยู่หลัง Odoo Enterprise (proprietary) ขัดเกณฑ์ "ไม่มี Paid Core Features" (2) สถาปัตยกรรมเป็น monolith ผูกแน่นกับ Odoo ORM/framework เอง ดึงเฉพาะโมดูลย่อยออกมาใช้ยาก ต้นทุน integration สูง ขัดเกณฑ์ Modular/Integration Cost |

**บทเรียน:** license เพียงอย่างเดียวไม่พอสำหรับตัดสินใจ — ERPNext ตัดที่ license, Odoo ตัดที่ feature-lock + architecture แม้ license ตัว Community จะผ่านเกณฑ์ขั้นต้นก็ตาม ต้องประเมินครบทุกข้อในเกณฑ์คัดเลือกเสมอ ไม่หยุดแค่ข้อแรกที่ผ่าน

## ขั้นถัดไป

1. เริ่มจาก **HRM ก่อน** — ไล่หา OSS ละเอียดครบทุกฟังก์ชัน HR: License + GitHub + Tech Stack + ฟังก์ชันที่มี/ขาด + ความเสี่ยง license + ตัวไหนควรประกอบกัน
2. ล็อก **ORVA HRM Stack** แล้วค่อยขยับไป Finance / Project / Support / Inventory

*(การเลือก OSS จริงเป็น Phase หลัง ORVA Core v0.1 — ดู [MILESTONES.md](MILESTONES.md))*
