# ADR 0016 — Canonical Entity Sync แบบ Event-driven Projection

- **สถานะ**: Accepted (2026-08-15) — canonical business entity ตัวแรก (`Employee`) implement จริง
- **เกี่ยวข้อง**: `employees` (migration), `orva-sync` (crate ใหม่), `GET /api/v1/employees`,
  [ADR 0014](0014-external-module-adapter.md) Phase 3 event hooks

## บริบท

ARCHITECTURE.md §8 วาง canonical data model ไว้ให้ทุก module เห็นข้อมูลธุรกิจรูปแบบ
เดียวกัน — ตั้งแต่ M1 มีแค่ placeholder ตอนนี้ Horilla ส่ง event `horilla.employee.*`
เข้า Event Bus แล้ว (Phase 3) คำถามคือจะ sync เข้า canonical ยังไง:
sync แบบ pull (poll API ฝั่ง Horilla) หรือ push (event-driven)

## การตัดสินใจ

### Event-driven projection — event log คือ source of truth

- crate ใหม่ **`orva-sync`**: subscribe ทุก event บน Event Bus, จับ pattern
  **`<module>.employee.<created|updated|deleted>`** → project ลงตาราง `employees`
- **contract เปิดกว้างต่อ module**: module ไหนก็ตาม (InvenTree, ตัวถัดไป) แค่ publish
  event ตาม pattern นี้ + payload มี `source_id` (fallback: `<module>_employee_id`)
  ก็ได้ canonical projection ฟรีโดยไม่ต้องแก้โค้ด ORVA
- ตาราง `employees`: unique `(organization_id, source_module, source_id)` —
  upsert **idempotent** (event ซ้ำ/replay ปลอดภัย), `deleted` = soft delete,
  event `created`/`updated` ที่มาหลัง delete ปลุกแถวกลับ (ค่าล่าสุดชนะ)
- projection **สร้างใหม่ได้เสมอ** จากการ replay event log (ตาราง `events` เป็น
  append-only source of truth ตาม ADR 0003) — แถว canonical เป็น derived data
- event ที่ payload ไม่ครบ contract (ไม่มี source id) ถูกข้ามพร้อม warning —
  ไม่ทำ pipeline พัง

### API

`GET /api/v1/employees` — permission ใหม่ `core.employee.read` (seed ใน migration)
ตอบพร้อม `source_module`/`source_id` ให้ตามกลับไปที่ระบบต้นทางได้

**หมายเหตุ**: องค์กรที่ provision ก่อน permission นี้เกิด ต้อง grant
`core.employee.read` ให้ role เพิ่มเอง (owner ได้ครบเฉพาะ catalog ณ ตอน provision —
พฤติกรรมที่บันทึกไว้ตั้งแต่ M3)

## ผลลัพธ์

- พิสูจน์อัตโนมัติ: `core/tests/external_module_flow.rs::employee_events_project_into_canonical_table`
  (created → แถวเกิด, updated → upsert ไม่เพิ่มแถว, deleted → หายจาก list,
  payload ไม่ครบ → ข้ามเงียบ) + unit tests ของ parser ใน orva-sync
- พิสูจน์กับ Horilla จริง: user ใหม่ SSO ครั้งแรก → Employee เกิดฝั่ง Horilla →
  hook → event → projection → `GET /api/v1/employees` เห็น canonical row
  (`source_module: horilla, source_id: 3`) — วงจร module → canonical ครบสาย
- สิ่งที่ยังไม่ทำ (ตั้งใจ): canonical entity ตัวอื่น (Customer/Invoice ฯลฯ — ใช้
  pattern เดียวกันเมื่อมี module ที่ส่ง event), replay tool (ตอนนี้ replay ต้องทำมือ),
  conflict resolution ข้าม module (สอง module ส่งพนักงานคนเดียวกัน — ตอนนี้เป็น
  คนละแถวตาม source)
