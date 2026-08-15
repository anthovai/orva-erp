# ADR 0005 — Row-Level Security เป็น defense-in-depth ชั้นที่สอง

- **สถานะ**: Accepted (2026-08-15)
- **เกี่ยวข้อง**: migration `20260815065029_row_level_security`, `orva_data::pool`

## บริบท

ตั้งแต่ M1 การแยกข้อมูลระหว่าง tenant พึ่ง **app-layer scoping** อย่างเดียว — ทุก
repository method บังคับรับ `organization_id` แล้วใส่ใน `WHERE` เอง ถ้ามี query ใด
ลืม scope (bug ในอนาคต, module ใหม่, raw SQL) ข้อมูลจะรั่วข้าม tenant ทันที
M3 บันทึกเรื่องนี้ไว้เป็น known gap พร้อมคำเตือนว่าการเปิด RLS ภายหลังต้อง wire
tenant context เข้าทุก call site ก่อน ไม่งั้นทุก query ได้ 0 แถว

## ทางเลือกที่พิจารณา

1. **RLS ด้วย GUC per-transaction** (เลือก) — policy อ่านค่า
   `current_setting('app.current_organization_id')` ที่แอปตั้งไว้ต่อ transaction
2. Database-per-tenant — แยกขาดจริงแต่ค่า ops สูงมาก ขัดกับ canonical data model
   ที่ตั้งใจให้ query ข้าม module ได้ในฐานเดียว
3. คง app-layer scoping อย่างเดียว — ไม่มีตาข่ายรองรับ bug

## การตัดสินใจ

### Policy

ทุกตาราง tenant-scoped (16 ตารางที่มีคอลัมน์ `organization_id`) ได้ policy:

```sql
using (organization_id = orva_rls_org() or orva_rls_bypass())
with check (organization_id = orva_rls_org() or orva_rls_bypass())
```

- `orva_rls_org()` = `current_setting('app.current_organization_id', true)::uuid`
  — GUC ไม่ถูกตั้ง → `NULL` → policy เป็น false → **0 แถว (fail-closed)**
- `ENABLE` + `FORCE ROW LEVEL SECURITY` ทุกตาราง — FORCE จำเป็นเพราะเจ้าของตาราง
  ปกติข้าม RLS ได้
- Join table ที่ไม่มี `organization_id` (`team_members`, `role_permissions`)
  scope ผ่าน subquery ไปยัง parent (`teams`, `roles`) แทนการเพิ่มคอลัมน์ซ้ำซ้อน
- **ยกเว้น 2 ตาราง**: `organizations` (tenant root — ต้อง lookup ด้วย slug ก่อนรู้
  context) และ `permissions` (global catalog ไม่มีข้อมูล tenant)

### ฝั่งแอป — `TenantTx`

`orva_data::pool::begin_tenant(pool, organization_id)` เปิด transaction แล้วตั้ง GUC
ผ่าน `set_config(..., true)` (transaction-local + bind parameter — ปลอดภัยกว่า
string-format `SET LOCAL`) ทุก repository method ที่แตะตาราง tenant-scoped รัน query
ผ่าน `TenantTx::as_executor()` แล้วปิดด้วย `.commit()` — ถ้า error ก่อนถึง commit
sqlx rollback ให้อัตโนมัติตอน drop **Public signature ของ repository ไม่เปลี่ยน**
(ยกเว้น 4 method ที่เดิมไม่รับ `organization_id` — เพิ่มให้ครบ) ผู้เรียกทุกชั้นจึงไม่รับรู้

### Bypass — จำกัดแค่ 2 bootstrap lookup

`begin_rls_bypass()` ตั้ง GUC `app.bypass_rls = 'on'` ใช้ได้เฉพาะ 2 จุดที่โครงสร้าง
บังคับให้ยังไม่รู้ organization:

| จุด | เหตุผลที่ปลอดภัย |
|---|---|
| `SessionRepository::find_by_token_hash` | token เป็นค่าสุ่ม 256-bit — hash ค้นแล้วมีแถวเดียวทั้งระบบ |
| `ServiceIdentityRepository::find_by_key_hash` | เดียวกัน (API key ของ agent/worker) |

จุดอื่นห้ามใช้ — code review ต้องปฏิเสธ `begin_rls_bypass` ที่โผล่นอก 2 จุดนี้

### Role แยกสำหรับแอป — `orva_app`

ปัญหาที่เจอตอน implement: role `orva` ที่ postgres image สร้างให้เป็น **superuser**
ซึ่ง**ข้าม RLS เสมอ** (แม้ FORCE) ทางแก้:

```sql
create role orva_app login password '...' nosuperuser nobypassrls in role orva;
```

- แอป/เทสต์เชื่อมต่อด้วย `orva_app` เท่านั้น — attribute `SUPERUSER`/`BYPASSRLS`
  **ไม่ถูกส่งต่อผ่าน role membership** จึงโดน RLS เต็ม ๆ
- membership `in role orva` ให้สิทธิ์ ownership — `orva_app` ยังรัน migration
  (create/alter table) ได้ตามปกติ
- `orva` (superuser) เหลือไว้เป็น admin/ops เท่านั้น
- role เป็น cluster-level จึง provision นอก migration: `docker/init-test-db.sql`
  (volume ใหม่), step ใน CI, และคำสั่งมือสำหรับ cluster ที่มีอยู่แล้ว
- รหัสผ่านใน init script เป็นค่า dev — **production ต้องตั้งใหม่เสมอ**

## ผลลัพธ์

- Query ที่ลืม scope `organization_id` ได้ 0 แถวแทนที่จะรั่ว — พิสูจน์ใน
  `crates/orva-data/tests/rls.rs` (query ตรงด้วย id ข้าม tenant → ว่าง,
  `WITH CHECK` ปฏิเสธ insert แถวของ org อื่น)
- ทุก DB call กลายเป็น transaction 3 statement (begin + set_config + query + commit)
  — overhead ยอมรับได้ที่ scale ปัจจุบัน ถ้าอนาคตเป็นคอขวดค่อยย้ายไปตั้ง GUC
  ระดับ connection pool hook
- ตาราง tenant-scoped ใหม่ในอนาคต**ต้อง** `ENABLE`+`FORCE` RLS + policy เดียวกัน
  ใน migration ของตัวเองเสมอ
