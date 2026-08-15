# Horilla HRM — External Module Integration

สถานะ: **Phase 1 เชื่อมแล้ว (2026-08-15)** — Horilla จริงรันแยก process ต่อผ่าน
HTTP adapter ([ADR 0014](../adr/0014-external-module-adapter.md)) ตาม LGPL boundary
ที่กำหนดใน [OSS-STRATEGY.md](../OSS-STRATEGY.md)

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

## Phase 2 — SSO middleware ฝั่ง Horilla (ยังไม่ทำ)

Horilla มี Django login ของตัวเอง — ให้ SSO ไร้รอยต่อต้องเพิ่ม middleware เล็ก ๆ
ฝั่ง Horilla ที่:

1. อ่าน header `X-Orva-Identity`
2. verify RS256 กับ JWKS ของ ORVA (`aud` ต้องเป็น `orva-module:horilla`, TTL 60 วิ):

```python
# แนวทาง (PyJWT) — วางเป็น Django middleware ใน Horilla process (LGPL อนุญาต)
import jwt
from jwt import PyJWKClient

jwks = PyJWKClient("http://orva-core:8080/.well-known/jwks.json")

def verify_orva_identity(token: str) -> dict:
    key = jwks.get_signing_key_from_jwt(token)
    return jwt.decode(token, key.key, algorithms=["RS256"],
                      audience="orva-module:horilla")
    # claims: sub (user id), org, email, name — ใช้ get_or_create Django user
```

3. map claim `email` → Django user (`get_or_create`) แล้ว login session ให้อัตโนมัติ

ข้อควรระวัง phase 2: Horilla เสิร์ฟ static asset ด้วย absolute path (`/static/...`)
— การใช้ Horilla UI เต็มหน้าผ่าน proxy ต้องเพิ่ม rewrite หรือชี้ static ตรง
(adapter ปัจจุบันเหมาะกับ **API access** เป็นหลัก)

## ขอบเขต/ข้อจำกัดปัจจุบัน

- proxy buffer body สูงสุด 10MB (อัปโหลดเอกสาร HR ไฟล์ใหญ่ให้เรียก Horilla ตรง)
- dev image รันด้วย Django devserver — production ต้องใช้ gunicorn + DEBUG=False
- event ขากลับ (Horilla → ORVA Event Bus) ใช้ `POST /api/v1/agent/events`
  ด้วย service key scope `agent:event:publish` — ยังไม่ได้ฝัง hook ในโค้ด Horilla
