# Horilla HRM — External Module Integration

สถานะ: **Phase 3 Event hooks ทำงานแล้ว (2026-08-15)** — SSO + event loop ครบสองทาง — Horilla จริงรันแยก process ต่อผ่าน
HTTP adapter ([ADR 0014](../adr/0014-external-module-adapter.md)) ตาม LGPL boundary
ที่กำหนดใน [OSS-STRATEGY.md](../OSS-STRATEGY.md) และ user ของ ORVA เข้าหน้า
protected ของ Horilla ได้ทันทีโดยไม่ต้องมีรหัสผ่านใน Horilla (auto-provision + login
ผ่าน identity assertion)

## สถาปัตยกรรม

```
Browser/Client ──Bearer session──▶ ORVA Core (:8080)
                                       │  /api/v1/ext/horilla/...
                                       │  + X-Orva-Identity (JWT RS256, 60s)
                                       │  + X-Orva-Organization-Id
                                       ▼
                              Horilla (:8000, Django)
                                       │
                              Horilla Postgres (แยกจาก ORVA DB เด็ดขาด)
```

- **License boundary**: Horilla (LGPL-2.1) รันเป็น container แยก มี Postgres ของตัวเอง
  ไม่มีโค้ด/DB ปนกับ ORVA — แก้ Horilla ได้เต็มที่ตราบใดที่ยังแยก process
- **ไม่มี secret แชร์**: identity assertion verify ผ่าน `/.well-known/jwks.json` ของ ORVA

## วิธีรัน (dev)

```bash
docker compose up -d horilla-db horilla
# ครั้งแรกเท่านั้น: migrate DB ของ Horilla
docker exec orva-horilla python manage.py migrate
# สร้าง admin user ของ Horilla (จัดการผ่าน UI ของ Horilla เอง)
docker exec -e DJANGO_SUPERUSER_PASSWORD=<pass> orva-horilla \
  python manage.py createsuperuser --noinput --username <user> --email <email>
```

Horilla UI ตรง: `http://localhost:8000` / ผ่าน ORVA proxy: `/api/v1/ext/horilla/...`

## ลงทะเบียนกับ ORVA (ต่อ tenant)

```bash
curl -X POST http://127.0.0.1:8080/api/v1/external-modules \
  -H "Authorization: Bearer <token>" -H "content-type: application/json" \
  -d '{"name":"horilla","base_url":"http://localhost:8000"}'
```

ตรวจ: `GET /api/v1/ext/horilla/login/` ด้วย session ปกติ → ได้หน้า Horilla กลับมา
(ไม่มี token → 401 ก่อนถึง Horilla เสมอ)

## Phase 2 — SSO middleware (`orva_sso` overlay) ✅

implement แล้วที่ [docker/horilla/orva_sso/](../../docker/horilla/orva_sso/) —
**ไม่แตะ source ของ Horilla เลย**: mount โฟลเดอร์เข้า `/app/orva_sso` (read-only)
แล้วชี้ `DJANGO_SETTINGS_MODULE=orva_sso.settings` ซึ่ง `from horilla.settings import *`
แล้วต่อท้าย middleware ตัวเดียว (ไฟล์ distribute เป็น LGPL-2.1 ให้เข้ากับ Horilla)

การทำงานของ `OrvaSSOMiddleware` ต่อ request:

1. อ่าน `X-Orva-Identity` — ไม่มี/user login อยู่แล้ว → ปล่อยผ่าน (login ปกติของ
   Horilla ยังใช้ได้ตามเดิม)
2. verify RS256 ผ่าน `PyJWKClient` กับ JWKS ของ ORVA (`ORVA_JWKS_URL`,
   `aud = orva-module:horilla`, leeway 10 วิ) — **ของปลอมตกที่ signature เสมอ
   แม้ยิงตรงเข้า Horilla port 8000** เพราะไม่มีใครมี private key ของ ORVA
3. ผ่านแล้ว `get_or_create` Django user จาก claim `email` (ตั้ง unusable password
   — เป็น SSO-only user, login ตรงกับ Horilla ไม่ได้) + สร้าง `Employee` record
   ขั้นต่ำให้ UI ใช้งานได้ แล้ว `login()` ให้อัตโนมัติ

**พิสูจน์แล้ว E2E**: `GET /api/v1/ext/horilla/employee/employee-view/` ด้วย ORVA
session → ได้หน้า Horilla จริง (176KB) ขณะที่ยิงตรง anonymous ได้ 302 ไป login
และ `auth_user` ใน DB ของ Horilla มี user ถูก provision อัตโนมัติแบบไร้รหัสผ่าน

### Gotcha ตอน setup (image 1.4)

Horilla patch field `is_new_employee` เข้า `auth.User` แต่ migration ไม่ได้ ship
มากับ image — ครั้งแรกต้องรันเพิ่ม (ไม่งั้น SSO provision ล้มด้วย
`column auth_user.is_new_employee does not exist`):

```bash
docker exec orva-horilla python manage.py makemigrations auth
docker exec orva-horilla python manage.py migrate auth
```

## Phase 3 — Event hooks (Horilla → ORVA Event Bus) ✅

implement ใน overlay เดียวกัน ([hooks.py](../../docker/horilla/orva_sso/hooks.py) +
`apps.py` — ลงทะเบียนผ่าน `INSTALLED_APPS` ใน settings overlay):

- Django `post_save`/`post_delete` signals บน **Employee** (created/updated/deleted),
  **LeaveRequest** (created/updated), **Attendance** (created) → POST
  `/api/v1/agent/events` ด้วย service key scope `agent:event:publish`
- **Best-effort โดยเจตนา**: ส่งใน daemon thread + timeout 3 วิ, error แค่ log —
  ORVA ล่มไม่ทำให้ Horilla พัง; ไม่ตั้ง `ORVA_SERVICE_KEY` = hook ปิดตัวเองเงียบ ๆ
- event เข้า audit log ของ ORVA และ **Intelligence rule ที่เฝ้า event_type เช่น
  `horilla.leave_request.created` ประเมินทันที** → insight/recommendation ต่อได้เลย

### วิธีเปิดใช้

```bash
# 1) ออก service key (ครั้งเดียวต่อ tenant)
curl -X POST http://127.0.0.1:8080/api/v1/service-identities \
  -H "Authorization: Bearer <token>" -H "content-type: application/json" \
  -d '{"name":"horilla-events","scopes":["agent:event:publish"]}'
# 2) ตั้ง env แล้ว recreate container
export HORILLA_ORVA_SERVICE_KEY=<api_key>
docker compose up -d horilla
```

**พิสูจน์แล้ว E2E**: user ใหม่ SSO เข้า Horilla ครั้งแรก → Employee ถูก provision →
hook ยิง → `GET /api/v1/events?event_type=horilla.employee.created` เห็น event
พร้อม payload (email/ชื่อ/horilla_employee_id) ใน audit log ของ ORVA

### ข้อจำกัดที่เหลือ

- Horilla เสิร์ฟ static asset ด้วย absolute path (`/static/...`) — เปิด UI เต็มหน้า
  ผ่าน proxy ได้ HTML แต่ asset ต้องชี้ตรงหรือเพิ่ม rewrite (adapter เหมาะกับ
  **API/SSO access** เป็นหลัก; UI เต็มจอให้เข้า `:8000` ตรงซึ่ง login ด้วย SSO ไม่ได้)
- session ของ Horilla เกิดใหม่ต่อ request ที่มากับ assertion (stateless ฝั่ง proxy)

## ขอบเขต/ข้อจำกัดปัจจุบัน

- proxy buffer body สูงสุด 10MB (อัปโหลดเอกสาร HR ไฟล์ใหญ่ให้เรียก Horilla ตรง)
- dev image รันด้วย Django devserver — production ต้องใช้ gunicorn + DEBUG=False
- ~~event ขากลับยังไม่ได้ฝัง hook~~ → **ทำแล้ว (Phase 3)** และ ~~canonical Employee
  sync~~ → **ทำแล้ว (Phase 4 — [ADR 0016](../adr/0016-canonical-projection.md))**:
  event `horilla.employee.*` ถูก project ลง canonical `employees` อัตโนมัติ
  ดูได้ที่ `GET /api/v1/employees` (permission `core.employee.read`) — เหลือ model
  อื่น ๆ (payroll, recruitment ฯลฯ) ที่ยังไม่ได้ hook
