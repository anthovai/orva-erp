# ADR 0011 — Fine-grained Agent Scopes บน Service Identity

- **สถานะ**: Accepted (2026-08-15) — ปิด known gap "fine-grained agent scope" ของ M8
- **เกี่ยวข้อง**: `service_identities.scopes` (migration), ORVA Agent API (`/api/v1/agent/*`)

## บริบท

M8 วาง Agent API ด้วย service identity — แต่ key ที่ auth ผ่านทำได้**ทุกอย่าง**
ใน Agent API เท่ากันหมด agent ตัวหนึ่งที่ควรได้แค่อ่านสถานะ กลับเสนอ action ได้ด้วย
ยิ่งต่อ OpenWorker หลาย connector ยิ่งต้องแยกสิทธิ์ต่อ key

## การตัดสินใจ

### Scope model — string list บน identity ไม่ใช่ role/permission ของ user

Service identity ไม่ใช่ user (ไม่มี role) — ใช้คอลัมน์ `scopes text[]` ตรง ๆ
เรียบกว่าและตรงกับธรรมเนียม API key ทั่วไป (GitHub PAT, OAuth scopes)

| scope | อนุญาต |
|---|---|
| `agent:context:read` | `GET /agent/context` |
| `agent:workflow:read` | `GET /agent/workflows/{id}` |
| `agent:workflow:propose` | `POST /agent/workflows` ทุก resource_type |
| `agent:workflow:propose:<resource_type>` | propose เฉพาะ resource_type นั้น |

### กติกา

- **Fail-closed**: ออก key โดยไม่ระบุ scope = key ที่ auth ผ่านแต่ทำอะไรไม่ได้เลย
  (ทุก endpoint 403 พร้อมบอกว่าขาด scope ไหน)
- **Validate ตอนออก key**: scope นอก catalog → 400 ทันที — กัน typo กลายเป็น
  key ใบ้เงียบ ๆ ที่ไปตายตอน runtime
- **แยกชั้นชัด**: 401 = key ผิด/หมดอายุ, 403 = key ถูกแต่ scope ไม่พอ
- scopes โชว์กลับใน response ตอนออก key และใน `/agent/context` (agent เช็คตัวเองได้)
- **Backfill**: key ที่ออกก่อน migration นี้ได้ครบ 3 scope กว้าง (เท่าพฤติกรรมเดิม —
  integration ที่มีอยู่เช่น OpenWorker connector ไม่พังกลางอากาศ) key ใหม่ต้องประกาศเอง

## ผลลัพธ์

- พิสูจน์ใน `core/tests/agent_flow.rs::agent_scopes_are_enforced_per_endpoint_and_resource_type`
  (scope มั่ว → 400 ตอนออก, key ไร้ scope → 403 ทุกทาง, key จำกัด `:invoice` →
  propose invoice ได้/purchase ไม่ได้/read ไม่ได้) + ยืนยัน manual
- สิ่งที่ยังไม่ทำ (ตั้งใจ): แก้ scope ของ key ที่ออกแล้ว (ตอนนี้ต้อง revoke แล้วออกใหม่ —
  ธรรมเนียมเดียวกับ API key ทั่วไป), scope สำหรับ endpoint อนาคตของ Agent API
  (เพิ่มเข้า catalog ตอน endpoint เกิด)
