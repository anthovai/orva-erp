# ADR 0014 — HTTP Adapter สำหรับ OSS Module ที่รันแยก Process

- **สถานะ**: Accepted (2026-08-15) — เปิดทางประกอบ Horilla/InvenTree ตาม OSS-STRATEGY.md
- **เกี่ยวข้อง**: `external_modules` (migration), `/api/v1/external-modules`,
  `/api/v1/ext/{name}/...`, `/api/v1/agent/events`, [ADR 0004](0004-module-system-compiled-not-dynamic.md)

## บริบท

ADR 0004 ระบุชัดว่า OSS module (Horilla — LGPL ต้องแยก process ตาม OSS-STRATEGY.md,
InvenTree — MIT แต่เป็น Python/Django) ใช้ compiled-in Module SDK ไม่ได้ —
ต้องมี "HTTP-adapter design" แยกต่างหาก นี่คือ design นั้น

## การตัดสินใจ

### ORVA = authenticated proxy + identity provider (ไม่ใช่แค่ reverse proxy)

```
client ──session──▶ ORVA Core ──X-Orva-Identity (JWT RS256)──▶ Horilla/InvenTree
                        │                                            │
                        ◀────── agent:event:publish (service key) ──┘
```

- **ขาเข้า module**: client เรียก `/api/v1/ext/{name}/{path}` ด้วย session ปกติ →
  Core auth + เช็ค module enabled → forward ทุก method/query/body ไป `base_url`
  พร้อมแนบ:
  - `X-Orva-Identity` — JWT **RS256 อายุ 60 วิ** `aud = orva-module:<name>`
    (sub/org/email/name ครบ) — module verify ผ่าน `/.well-known/jwks.json` เอง
    **ไม่มี secret แชร์** — นี่คือ relying party จริงตัวแรกของ ADR 0006
  - `X-Orva-Organization-Id` — tenant context
  - session token ของ user **ไม่ถูก forward เด็ดขาด** (strip `authorization`)
- **ขาออกจาก module**: module publish event กลับเข้า ORVA Event Bus ผ่าน
  `POST /api/v1/agent/events` ด้วย service identity + scope ใหม่
  `agent:event:publish` — เข้า audit log และ Intelligence Engine ประเมิน rule ทันที
  (loop: Horilla สร้าง employee → event → rule → insight/recommendation)

### Registration

- `POST /api/v1/external-modules` (permission `core.module.manage`) —
  `{name, base_url}` upsert ตามชื่อ, ชื่อถูก constrain `^[a-z0-9][a-z0-9_-]{1,62}$`
  ที่ DB, ตารางอยู่ใต้ FORCE RLS ตามกติกา ADR 0005
- enable/disable ต่อ tenant — disable แล้ว proxy ตอบ 404 ทันที
- **SSRF surface โดยเจตนา**: base_url เป็นค่าที่ admin (ผู้ถือ `core.module.manage`)
  ตั้งเอง — trust level เดียวกับการ config webhook ทั่วไป ไม่รับ URL จาก user ปลายทาง

### Authorization ละเอียดเป็นหน้าที่ module ปลายทาง

Core ยืนยันแค่ "user คนนี้ องค์กรนี้ ตัวจริง" — Horilla/InvenTree มี role/permission
ของตัวเอง ให้ map จาก claim ใน assertion (email/sub) ฝั่งนั้น เพราะ permission
ของ HR (`ใครเห็นเงินเดือนใคร`) เป็น domain knowledge ของ module ไม่ใช่ของ Core

## ผลลัพธ์

- พิสูจน์ใน `core/tests/external_module_flow.rs` — test spin "Horilla จำลอง" จริงบน
  ephemeral port: proxy ส่งถึง, assertion verify ผ่าน JWKS จริง, session token ไม่รั่ว,
  disable → 404, event publish ต้องมี scope + query กลับจาก audit log ได้
- ยืนยัน manual: ลงทะเบียน **Mailpit จริง** เป็น external module แล้วอ่าน inbox
  ผ่าน `/api/v1/ext/mailpit/api/v1/messages` สำเร็จ + agent event publish จริง
- สิ่งที่ยังไม่ทำ (ตั้งใจ): health check/monitoring ของ module, streaming body
  (ตอนนี้ buffer สูงสุด 10MB ต่อ request), SSO login เต็มรูปแบบฝั่ง module
  (Authorization Code flow — gap เดิมของ ADR 0002), sync canonical data
  (Employee ↔ Horilla) ซึ่งเป็นงาน adapter เฉพาะ module ถัดไป
