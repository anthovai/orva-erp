# ADR 0001 — Core Technology Stack

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

ORVA Core เป็น Control Plane ที่เขียนเองทั้งหมด (ดู [ARCHITECTURE.md](../ARCHITECTURE.md)) ต้องล็อก stack หลักตั้งแต่ M0 เพื่อไม่ให้แต่ละ crate เลือกคนละทาง

## Decision

| ส่วน | เลือก | เหตุผล |
|---|---|---|
| ภาษา | **Rust (stable, edition 2021)** | ตาม Architecture Direction — performance, safety, ownership ของ Core |
| Async runtime | **tokio** | de-facto standard, ecosystem ใหญ่สุด |
| Web framework | **axum** | ทีมเดียวกับ tokio, tower middleware ecosystem, type-safe extractors |
| Database | **PostgreSQL 17** | ต้องการ RLS/isolation สำหรับ multi-tenant, JSON support สำหรับ event payload |
| DB access | **sqlx** (เริ่มใช้จริงใน M1) | compile-time checked SQL, ไม่บังคับ ORM abstraction — Canonical Data Model ควบคุม schema เองตรง ๆ |
| Serialization | **serde** + serde_json + toml | standard |
| Error | **thiserror** ผ่าน crate กลาง `orva-error` | error type เดียวทั้ง workspace, framework-agnostic |
| Observability | **tracing** + tracing-subscriber | structured logging, ต่อ OpenTelemetry ได้ภายหลัง |

โครง workspace:

```
orva-erp/
├── core/            # orva-core — binary หลัก (API server)
├── crates/          # library crates ภายใน (orva-config, orva-error, ...)
├── modules/         # business modules (Phase ถัดไป)
├── config/          # configuration files
└── docs/            # ARCHITECTURE, MILESTONES, ADR
```

## Consequences

- ทุก crate ใหม่ต้องใช้ dependency version จาก `[workspace.dependencies]` เท่านั้น
- Event Bus (M5) จะเริ่มแบบ in-process ก่อน — การเลือก broker ภายนอก (NATS ฯลฯ) เป็น ADR แยกเมื่อถึง M5
- Agent Execution Plane (OpenWorker, Python) อยู่นอก workspace นี้ — เชื่อมผ่าน ORVA Agent API (M8) เท่านั้น
