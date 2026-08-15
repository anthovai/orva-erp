# ORVA ERP — Intelligence Engineered

> Architecture Direction — ORVA Platform
>
> สถานะ: Draft v0.3 · อัปเดตล่าสุด: 2026-08-14

## แนวคิดหลัก

**ORVA ERP is an intelligence-engineered business platform built from open foundations and unified through a single intelligent core.**

เป้าหมายของระยะนี้ **ไม่ใช่** สร้าง HRM / Finance / Project ให้ครบ แต่คือสร้าง **ORVA Core Platform** ให้พร้อมเสียบทุกอย่างเข้ามาได้ภายหลัง การเลือก OSS สำหรับแต่ละ Office เป็น Phase ถัดไป และต้องไม่เอามากำหนดการออกแบบ Core

## สถาปัตยกรรม 3 ชั้น (Architecture Overview)

ORVA แบ่งเป็น 3 ชั้นใหญ่ + Business Modules:

| ชั้น | หน้าที่ | เทคโนโลยีฐาน |
|---|---|---|
| **ORVA Core** | ระบบกลาง — Identity / Data / Events / Permissions / Modules / Workflow / Security | เขียนเองด้วย Rust |
| **ORVA Intelligence** | ทำให้ข้อมูลทั้งหมด "มีความหมาย" — Context / Knowledge / Reasoning / Analytics / AI / Decision | Intelligence Engine + Knowledge Foundation (แนวคิดจาก Obsidian) |
| **ORVA Workers** | "ลงมือทำ" — Agents / Automation / Tools / MCP / Scheduled Jobs / Human Approval | OpenWorker (MIT License) |
| **Business Modules** | HRM / Finance / Project / Support / Inventory / **CRM** / Knowledge | OSS ที่เลือกใน Phase ถัดไป |

```
                         ORVA ERP
                  INTELLIGENCE ENGINEERED
                              │
 ┌────────────────────────────┼────────────────────────────┐
 │                            │                            │
 ▼                            ▼                            ▼
ORVA CORE              ORVA INTELLIGENCE              ORVA WORKERS
 Rust                       Engine                     OpenWorker
 │                            │                            │
 ├─ Identity                 ├─ Context                   ├─ Agents
 ├─ SSO                      ├─ Knowledge                 ├─ Tools
 ├─ RBAC                     ├─ AI                        ├─ MCP
 ├─ Tenant                   ├─ Reasoning                 ├─ Automation
 ├─ API                      ├─ Analytics                 └─ Approval
 ├─ Events                   └─ Decision
 ├─ Workflow
 └─ Modules
                              │
                              ▼
                    ┌─────────────────────┐
                    │  ORVA BUSINESS      │
                    │      MODULES        │
                    ├─────────────────────┤
                    │ HRM                 │
                    │ Finance             │
                    │ Project             │
                    │ Support             │
                    │ Inventory           │
                    │ CRM                 │
                    │ Knowledge           │
                    └─────────────────────┘
```

**หลักการสำคัญ:** Obsidian และ OpenWorker **ไม่ใช่** โมดูลที่ 6–7 แต่ถูกยกระดับเป็น Infrastructure ของ Intelligence:

- **Obsidian** → Knowledge Foundation (เอาแนวคิด/ระบบ knowledge — ดูข้อควรระวังเรื่อง license ใน [§9](#9-orva-knowledge--knowledge-layer))
- **OpenWorker** → Worker/Agent Foundation
- **Rust** → ORVA Core (Control Plane)
- **Intelligence Engine** → ตัวกลางที่เชื่อม Data + Knowledge + AI + Workers

---

# Layer 1: ORVA Core

## 1. ORVA Core — หัวใจของระบบ

เขียนเองด้วย **Rust** — นี่คือสิ่งที่ Orva ต้องเป็นเจ้าของเอง

```
ORVA ERP
│
└── ORVA CORE
    │
    ├── Identity
    ├── Authentication
    ├── SSO
    ├── Authorization
    ├── Organization
    ├── Tenant
    ├── User
    ├── Role & Permission
    │
    ├── API Gateway
    ├── Module System
    ├── Event Bus
    ├── Workflow Engine
    │
    ├── Data Layer
    ├── Search
    ├── File Storage
    ├── Notification
    ├── Audit Log
    │
    └── Intelligence Engine
```

## 2. Identity & SSO

ผู้ใช้ Login ครั้งเดียว เข้าได้ทุก Module — ไม่ว่า Module จะมาจาก OSS ตัวไหน ผู้ใช้ต้องรู้สึกว่าเป็น Application เดียว

```
ORVA LOGIN
     ↓
ORVA IDENTITY
     ↓
┌────┬──────┬───────┬────────┬───────────┬─────┐
HRM  Finance Project Support Inventory   CRM
```

ต้องรองรับ:

- User / Organization / Teams
- Roles / Permissions
- Session
- SSO, OAuth/OIDC
- MFA (อนาคต)
- Service Identity

## 3. Multi-Tenant Architecture

ออกแบบรองรับ multi-tenant **ตั้งแต่วันแรก** เพราะอนาคต Orva ต้องเป็นทั้ง **Self-hosted + Cloud/SaaS** — ถ้าไม่วาง Tenant ตั้งแต่แรก การเพิ่มทีหลังจะเจ็บมาก

```
ORVA
│
├── Organization A
│   ├── Users
│   ├── HRM
│   ├── Finance
│   └── Projects
│
├── Organization B
│   └── ...
│
└── Organization C
```

## 4. Universal Permission System

อย่าให้แต่ละ Module มีระบบ Permission ของตัวเอง — ให้ Orva เป็นคนกลาง

```
User → Role → Permission → Resource → Action
```

รูปแบบ permission key:

```
finance.invoice.read
finance.invoice.create
finance.invoice.approve

hr.employee.read
hr.employee.update

project.task.create
project.task.assign
```

OSS ที่นำมาใช้ต้องถูกแปลง (map) เข้าระบบ Permission ของ Orva ได้

## 5. Module System

Orva ต้องมองทุกส่วนเป็น Module

```
ORVA
│
├── Core
│
├── Modules
│   ├── HRM
│   ├── Finance
│   ├── Project
│   ├── Support
│   ├── Inventory
│   └── CRM
│
└── Extensions
```

แต่ละ Module มี **Contract มาตรฐาน**:

```
Module
├── Manifest
├── Version
├── Dependencies
├── Permissions
├── APIs
├── Events
├── Database
├── UI
└── Configuration
```

เป้าหมายระยะยาว:

```
orva install hrm
orva install finance
orva install crm
```

## 6. Event-Driven Architecture

หัวใจของ Intelligence Engineered — แทนที่ทุกระบบจะเรียกกันตรง ๆ (HR → Finance → Project → Inventory) ให้ Core มี **Event Bus** เป็นตัวกลาง

```
HRM
 │
 │ EmployeeCreated
 ▼
ORVA EVENT BUS
 │
 ├── Finance
 ├── Project
 ├── Notification
 ├── Audit
 └── Intelligence Engine
```

ตัวอย่าง flow:

```
InvoiceApproved → Event Bus → Finance → Project → Notification → Intelligence Engine
```

ผลลัพธ์: Module ใหม่เข้ามาฟัง Event ได้โดยไม่ต้องแก้ Module เดิม

## 7. Workflow Engine

Orva ไม่ใช่แค่ CRUD — มี Workflow กลางที่ทุก Office ใช้ร่วมกัน

```
Create → Review → Approve → Execute → Complete
```

กำหนดเงื่อนไขได้:

```
IF invoice.amount > 100,000  → Require Manager Approval
IF employee.leave_days > X   → Require HR Approval
```

## 8. Data Layer — Canonical Data Model

กำหนด Entity กลางตั้งแต่ Core ไม่ให้แต่ละ OSS นิยามข้อมูลของตัวเองจนข้อมูลไม่ตรงกัน (เช่น Customer ใน Finance ≠ Customer ใน Support)

Entity กลาง:

```
User, Organization, Employee, Customer, Vendor, Product,
Project, Invoice, Transaction, Document, Task, Ticket
```

ทุก Module อ้างอิง Entity เดียวกัน:

```
ORVA Customer
       │
 ┌─────┼─────┐
 ▼     ▼     ▼
CRM  Finance Support
```

นี่คือหนึ่งในความแตกต่างสำคัญของ Orva

---

# Layer 2: ORVA Intelligence

## 9. ORVA Knowledge — Knowledge Layer

> ฐานแนวคิดจาก **Obsidian** — แต่**ไม่ใช่**การเอา Obsidian มาเป็น Office/Module

ORVA Knowledge เป็นชั้นความรู้ขององค์กร:

```
ORVA Knowledge
├── Documents
├── Notes
├── Wiki
├── Knowledge Base
├── Meeting Notes
├── Project Knowledge
├── SOP
├── Policies
└── Company Memory
```

เชื่อมกับทุก Module:

```
Project A                    HR
   │                          │
   ├── Tasks                  ├── Employee
   ├── Documents              ├── Policies
   ├── Meeting Notes          ├── Training
   ├── Decisions              └── Knowledge
   └── Knowledge
```

**⚠️ ข้อสรุปเรื่อง License (ตรวจสอบแล้ว 2026-08-14):**

- repo `anthovai/obsidian` เป็น fork ของ `obsidianmd/obsidian-releases` ซึ่งเป็นแค่ repository โฮสต์ releases / รายชื่อ community plugins / themes (metadata `.json`) — **ไม่ใช่ source code ของ Obsidian**
- repo `obsidian-releases` **ไม่มีไฟล์ LICENSE** → ตามกฎ GitHub ถือว่า **All Rights Reserved** นำโค้ด/ไฟล์ไปใช้ต่อไม่ได้
- ตัวแอป Obsidian เองเป็น **Proprietary / Closed-Source** — ใช้ส่วนบุคคลฟรี แต่ใช้ในองค์กรตั้งแต่ 2 คนขึ้นไปต้องซื้อ Commercial License ($50/คน/ปี ตาม Obsidian EULA / Developer Policies)

**ผลต่อ ORVA (ตัดสินแล้ว):** ห้ามนำ Obsidian (ทั้งโค้ดและตัวแอป) มาเป็นฐานหรือ embed ใน Orva ทุกกรณี — ORVA Knowledge ใช้เฉพาะ **แนวคิด/รูปแบบระบบ knowledge** (linked notes, wiki, knowledge graph, markdown-based) มาออกแบบและสร้างเอง ถ้าจะหา OSS knowledge base มาเป็น foundation ต้องผ่านเกณฑ์ license ใน [OSS-STRATEGY.md](OSS-STRATEGY.md)

## 10. Intelligence Engine

**ยังไม่สร้าง AI Agent ใหญ่ตอนนี้** — ช่วงแรกสร้าง Infrastructure สำหรับ Intelligence ก่อน

```
ORVA DATA
    │
    ▼
EVENTS
    │
    ▼
CONTEXT ENGINE
    │
    ▼
RULES / ANALYTICS / AI
    │
    ▼
INTELLIGENCE
    │
    ├── Insight
    ├── Recommendation
    ├── Automation
    ├── Prediction
    └── Action
```

Intelligence Engine คือตัวกลางที่เชื่อม Knowledge + Context + Events แล้วส่งต่อให้ Workers ลงมือทำ:

```
                      ORVA CORE
                         │
              ┌──────────▼──────────┐
              │ INTELLIGENCE ENGINE │
              └──────────┬──────────┘
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
          Knowledge    Context     Events
              │          │          │
              └──────────┼──────────┘
                         ▼
                    ORVA WORKER
                         │
                ┌────────┼────────┐
                ▼        ▼        ▼
              Think     Act     Automate
```

ตัวอย่างในอนาคต: *"ค่าใช้จ่ายของ Project A เพิ่มขึ้น 18% ในเดือนนี้"* — Intelligence Engine ตรวจ Finance / Project / Resource, วิเคราะห์ Pattern, แจ้งผู้บริหาร, เสนอ Action

ดังนั้น AI ไม่ได้อยู่แค่หน้า Chat แต่สามารถ: **อ่านบริบทขององค์กร → เข้าใจข้อมูล → วางแผน → เรียก Module → ทำงาน → ตรวจสอบ → ขออนุมัติ → ส่งผลลัพธ์**

---

# Layer 3: ORVA Workers

## 11. ORVA Worker — Agent / Worker Engine

> ฐานจาก **OpenWorker** (`anthovai/openworker`, fork ของ OpenWorker, MIT License) — AI coworker/agent ที่ทำงานจริงผ่าน files, terminal และ integrations, รองรับ MCP, automation และ approval ก่อนการกระทำสำคัญ (Python agent backend + React/Tauri desktop UI)

ORVA Worker ไม่ใช่แค่ Chatbot แต่เป็น Agent ที่ทำงานครบวงจร:

```
User
 ↓
"ทำรายงานค่าใช้จ่ายเดือนนี้ให้หน่อย"
 ↓
ORVA Worker
 ↓
วางแผน
 ↓
เรียก Finance
 ↓
เรียก Project
 ↓
อ่าน Documents
 ↓
วิเคราะห์
 ↓
สร้าง Report
 ↓
ขอ Approval ถ้าจำเป็น
 ↓
ส่งผลลัพธ์
```

OpenWorker มีแนวคิดนี้อยู่แล้ว: รับ outcome → แบ่งงานเป็นขั้นตอน → ใช้ tools/connectors → ขออนุมัติก่อนการกระทำที่มีผลกระทบ → ส่งมอบผลลัพธ์ และรองรับ MCP ซึ่งเข้ากับ Architecture ของ Orva

## 12. Control Plane / Execution Plane

**Rust ไม่จำเป็นต้องเขียน Agent ใหม่** — แบ่งหน้าที่ชัดเจน:

- **Rust (ORVA Core) = Control Plane** — identity, permission, audit, orchestration
- **OpenWorker (ORVA Worker) = Agent Execution Plane** — วางแผนและลงมือทำ

```
                 ORVA CORE
                   Rust
                     │
             ORVA Agent API
                     │
              ┌──────▼──────┐
              │ ORVA WORKER │
              │  OpenWorker │
              └──────┬──────┘
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
        Tools       MCP       ORVA API
          │          │          │
          └──────────┼──────────┘
                     ▼
             ORVA MODULES
```

---

# Cross-cutting Concerns

## 13. Unified UI

เบื้องหลังอาจมี OSS หลายตัว แต่ UI ต้องรู้สึกเป็น Orva เดียว — ผู้ใช้ต้องไม่รู้สึกว่า "กำลังใช้ OSS ตัวที่ 3" แต่รู้สึกว่า "กำลังใช้ Orva"

```
┌──────────────────────────────────────────────┐
│ ORVA                              🔔  User   │
├──────────────┬───────────────────────────────┤
│ Dashboard    │                               │
│ HRM          │       ORVA WORKSPACE          │
│ Finance      │                               │
│ Projects     │                               │
│ Support      │                               │
│ Inventory    │                               │
│ CRM          │                               │
│              │                               │
│ Settings     │                               │
└──────────────┴───────────────────────────────┘
```

## 14. Security

Core ต้องวาง Security ตั้งแต่แรก โดยเฉพาะเมื่อนำ OSS หลายตัวมาอยู่ในระบบเดียวกัน:

- Authentication / Authorization
- Token management / Session management
- Encryption / Secrets management
- Audit trail
- API security / Rate limiting
- Tenant isolation
- Security events

---

# Scope & Phasing

## 15. Out of Scope — สิ่งที่ยังไม่ทำใน Phase นี้

เพื่อไม่ให้โปรเจกต์บาน:

- ❌ HRM เต็มระบบ
- ❌ Finance เต็มระบบ
- ❌ Inventory เต็มระบบ
- ❌ CRM เต็มระบบ
- ❌ เลือก OSS ทุกตัวตอนนี้
- ❌ AI Agent เต็มระบบ
- ❌ Mobile App
- ❌ Marketplace

แต่สร้าง **Foundation ที่รองรับทั้งหมด**

## 16. ORVA Core v0.1 — Scope ของ Phase แรก

```
ORVA CORE v0.1
│
├── Rust Core
│
├── Identity
│   ├── User
│   ├── Organization
│   ├── Session
│   └── SSO
│
├── Authorization
│   ├── Role
│   ├── Permission
│   └── Policy
│
├── Tenant
│
├── API Gateway
│
├── Module System
│
├── Event Bus
│
├── Workflow Engine
│
├── Data Layer
│
├── Audit Log
│
├── Notification
│
└── Intelligence Foundation
```

ภาพรวมเมื่อ Core เสร็จ:

```
                    ORVA CORE
                       │
        ┌──────────────┼──────────────┐
        │              │              │
     Identity        Events       Intelligence
        │              │              │
        └──────────────┼──────────────┘
                       │
                 Module System
                       │
       ┌───────┬───────┼───────┬───────┬───────┐
       ▼       ▼       ▼       ▼       ▼       ▼
      HRM   Finance  Project Support Inventory CRM
```

**หลักการตัดสินใจ:** ถ้า Core ออกแบบดี ต่อให้วันหลังนำ OSS ตัวใหม่เข้ามา หรือสร้าง Module ของเราเอง ก็เสียบเข้า Orva ได้โดยไม่ต้องรื้อระบบหลัก — "ORVA ERP — Intelligence Engineered" คือ Architecture Direction ส่วนการเลือก OSS แต่ละ Office เป็น Phase ถัดไป

---

## สรุปทิศทาง

ORVA ERP = **Core + Knowledge + Intelligence + Autonomous Work Execution** — ไม่ใช่ ERP ที่เอา AI Chat มาติดเพิ่มทีหลัง

| ส่วน | บทบาท |
|---|---|
| Rust | ORVA Core (Control Plane) |
| Obsidian (แนวคิด) | Knowledge Foundation |
| OpenWorker | Worker/Agent Foundation (Execution Plane) |
| Intelligence Engine | ตัวกลางเชื่อม Data + Knowledge + AI + Workers |
| HRM / Finance / Project / Support / Inventory / CRM / Knowledge | Business Modules |

## Revision History

| Version | วันที่ | สาระสำคัญ |
|---|---|---|
| v0.1 | 2026-08-14 | ORVA Core Platform direction — Core เดียว + Business Modules |
| v0.2 | 2026-08-14 | ยกระดับเป็นสถาปัตยกรรม 3 ชั้น (Core / Intelligence / Workers) — เพิ่ม ORVA Knowledge (แนวคิดจาก Obsidian) และ ORVA Worker (ฐานจาก OpenWorker), แบ่ง Control Plane / Execution Plane |
| v0.3 | 2026-08-14 | เพิ่ม **CRM เป็น Office/Business Module ที่ 6** (ทุก diagram/รายการโมดูล) — ริเริ่มจากการตรวจ license `horilla/horilla-crm` |
