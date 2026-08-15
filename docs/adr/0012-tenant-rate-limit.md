# ADR 0012 — Per-tenant Rate Limit (สองชั้นร่วมกับ per-key limiter เดิม)

- **สถานะ**: Accepted (2026-08-15) — ปิด known gap "rate limit ต่อ tenant จริง" ของ M4
- **เกี่ยวข้อง**: `organizations.rate_limit_per_minute` (migration),
  `core::rate_limit::TenantRateLimiter`, `/api/v1/organizations/current/rate-limit`

## บริบท

M4 มี rate limit ต่อ **key** (bearer token → IP → anonymous) — องค์กรที่มี user/agent
หลายตัวได้ quota คูณจำนวน token ไม่มีเพดานรวมของ tenant ทั้งก้อน

## การตัดสินใจ

### สองชั้น ไม่ใช่แทนที่กัน

| ชั้น | key | บังคับที่ | ปกป้องอะไร |
|---|---|---|---|
| per-key (M4 เดิม) | token/IP | middleware ก่อน auth | brute force, endpoint สาธารณะ, ราคาถูก (ไม่แตะ DB) |
| **per-tenant (ใหม่)** | organization_id | auth extractor หลังรู้ tenant | เพดานรวมทั้งองค์กร — noisy tenant ไม่เบียดคนอื่น |

per-tenant ต้องรู้ organization ก่อน จึงบังคับใน `AuthUser`/`ServiceIdentityAuth`
(จุดเดียวที่ identity เพิ่งถูก resolve) — user และ agent นับรวม quota เดียวกัน

### Quota

- `organizations.rate_limit_per_minute` (null = default ระบบ 1,000 req/min —
  ตั้งใจสูงกว่า per-key มากเพราะรวมทั้งองค์กร)
- quota ถูก cache ใน memory ต่อ org (TTL 60 วิ) — ไม่แตะ DB ทุก request;
  การแก้ผ่าน API invalidate cache ตรง ๆ จึงมีผลทันที
- limiter เป็น in-process governor ต่อ org — **ยังเป็น per-instance** ไม่ shared
  ข้าม replica (single-binary v0.1; ค่อยย้ายเป็น Redis/shared store ตอน scale out)

### Endpoint จัดการ + กันล็อกตัวเอง

- `POST /api/v1/organizations/current/rate-limit` (permission
  `core.organization.manage`) — `null` = กลับ default
- **endpoint นี้ยกเว้นจาก tenant limiter เอง** — เจอตอน verify จริง: องค์กรที่ตั้ง
  quota ต่ำเกินโดน 429 จนแก้ quota ตัวเองไม่ได้ endpoint จึง auth มือ (session +
  permission) โดยไม่เรียก tenant check
- ทุกการแก้ publish event `organization.rate_limit_changed` เข้า audit log
- 429 ของทั้งสองชั้นตอบ shape เดียวกัน (`{"error":"rate limit exceeded"}`) —
  เพิ่ม `Error::RateLimited` เป็น variant กลางใน orva-error

## ผลลัพธ์

- พิสูจน์ใน `core/tests/gateway_flow.rs`:
  `per_tenant_rate_limit_throttles_whole_organization` (quota 2 → 3rd request 429,
  องค์กรอื่นไม่กระทบ) และ `rate_limit_endpoint_is_exempt_so_org_can_unlock_itself`
  (โดน throttle อยู่ก็ยังปลดล็อกตัวเองได้) + ยืนยัน manual ครบทั้งสองพฤติกรรม
- สิ่งที่ยังไม่ทำ (ตั้งใจ): shared state ข้าม replica, `Retry-After` header,
  quota แยกต่อ endpoint class (อ่าน vs เขียน)
