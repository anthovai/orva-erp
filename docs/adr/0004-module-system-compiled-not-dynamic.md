# ADR 0004 — Module System: Compile-in ก่อน ไม่ Dynamic-load ใน v0.1

- **Status:** Accepted
- **Date:** 2026-08-15

## Context

M7 ต้องออกแบบ Module System ตาม ARCHITECTURE.md §5 ที่ต้องการให้ "orva install hrm" เป็นไปได้ในอนาคต ทางเลือกหลักคือ:

1. **Dynamic loading จริง** — module เป็น `.so`/`.dll` แยก โหลดตอน runtime ผ่าน `libloading` หรือคล้ายกัน
2. **Compile เข้า binary เดียวกัน** — module เป็น Rust crate ที่ workspace depend ตรง ๆ ตอน compile แต่ "install/enable/disable per tenant" เป็น runtime state ในฐานข้อมูล

## Decision

เลือก **(2) compile เข้า binary เดียวกัน** สำหรับ v0.1:

- ทุก module implement `orva_module_sdk::Module` trait แล้วถูก `.register()` เข้า `ModuleRegistry` ที่จุดเดียวใน `orva-core` (`AppState::with_rate_limit`) — เพิ่ม module ใหม่แก้แค่บรรทัดนี้บรรทัดเดียว ไม่แตะ routes.rs/permissions.rs/docs.rs ของ Core
- "การติดตั้ง" ที่มีความหมายจริงคือ **runtime state ต่อ tenant** ใน `module_installations` table — module ที่ compile เข้ามาแล้วแต่ organization ไม่ได้ install จะเรียก route ไม่ได้เลย (`RequireModulePermission<K>` เช็คให้อัตโนมัติทุก request)
- Permission key ที่ module ประกาศใน manifest ถูก **upsert เข้า catalog กลางแบบ idempotent** ตอน server เริ่มทำงาน (`ModuleRegistry::initialize`) — module ไม่ต้องแก้ migration ของ Core

## Consequences

- **ข้อดี:** compile-time type safety เต็มรูปแบบ (ผิด signature = compile error ไม่ใช่ runtime crash), ไม่มีความเสี่ยงด้าน memory safety จากการโหลด `.so` ที่ไม่รู้จัก, deploy ง่าย (binary เดียว)
- **ข้อจำกัด:** เพิ่ม/ถอด module ต้อง **recompile + redeploy** binary ใหม่เสมอ ไม่สามารถ "ติดตั้ง module ใหม่ตอน runtime โดยไม่ downtime" ได้จริงแบบที่คำว่า "orva install hrm" อาจสื่อถึง — ระบบตอนนี้คือ "orva install hrm" = เปิดใช้งาน module ที่ compile มาด้วยอยู่แล้วให้ tenant หนึ่ง ๆ ไม่ใช่การดึงโค้ดใหม่มาจากที่ไหน
- เมื่อ module มาจาก OSS ภายนอกจริง (Horilla, InvenTree ตามที่วางแผนไว้ใน [OSS-STRATEGY.md](../OSS-STRATEGY.md)) ซึ่งเป็นคนละภาษา/รันเป็น service แยก อยู่แล้ว (Python/Django) — module เหล่านั้น**ไม่ได้ใช้ mechanism นี้เลย** ต้องมี adapter แบบอื่น (HTTP proxy + service identity ที่มีอยู่แล้วจาก M2) ซึ่ง `orva-module-sdk` ในรูปแบบปัจจุบัน (Rust trait ตรง ๆ) ใช้ไม่ได้กับ module แบบนั้น — ~~เป็น known gap ที่ต้องออกแบบเพิ่มตอนเริ่มต่อ OSS module จริง~~ **ออกแบบแล้ว 2026-08-15: ดู [ADR 0014](0014-external-module-adapter.md)** (authenticated proxy + identity assertion ผ่าน JWKS)
- Dynamic loading เป็นตัวเลือกที่ถูกตัดออกทั้งหมดในรอบนี้ ไม่ใช่แค่เลื่อน — ถ้าต้องการจริง ๆ ในอนาคตต้องมี ADR ใหม่ที่ประเมิน trade-off ด้าน safety/ABI stability ใหม่ทั้งหมด
