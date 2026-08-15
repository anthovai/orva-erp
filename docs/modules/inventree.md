# InvenTree Inventory — External Module Integration

สถานะ: **ครบวงจรแล้ว (2026-08-15)** — proxy + SSO + Part events → canonical Product — InvenTree จริง (MIT, official image
`inventree/inventree:stable`) รันแยก process/DB ต่อผ่าน HTTP adapter
([ADR 0014](../adr/0014-external-module-adapter.md)) ด้วย **pattern เดียวกับ
[Horilla](horilla.md)** — และ canonical Product projection พร้อมแล้วฝั่ง ORVA
([ADR 0016](../adr/0016-canonical-projection.md))

## สถาปัตยกรรม

```
Browser/Client ──Bearer session──▶ ORVA Core (:8080)
                                       │  /api/v1/ext/inventree/...
                                       │  + X-Orva-Identity (JWT RS256)
                                       │  + X-Orva-User-Email  ◀── SSO ใช้ตัวนี้
                                       ▼
                              InvenTree (:8001, Django/gunicorn)
                                       │
                              InvenTree Postgres (แยกจาก ORVA DB)
```

## SSO — ใช้ remote-login ในตัวของ InvenTree (zero-code!)

ต่างจาก Horilla ที่ต้องมี middleware overlay — InvenTree รองรับ proxy-header
authentication มาแต่กำเนิด แค่ตั้ง env สองตัว:

```yaml
INVENTREE_REMOTE_LOGIN: "true"
INVENTREE_REMOTE_LOGIN_HEADER: "HTTP_X_ORVA_USER_EMAIL"
```

ORVA proxy แนบ `X-Orva-User-Email` (เซ็ตเองหลัง auth — header ปลอมจาก client
ถูก strip เสมอ) → InvenTree auto-create user + login ให้ทันที

**พิสูจน์แล้ว**: `GET /api/user/me/` ยิงตรง = 401, ผ่าน
`/api/v1/ext/inventree/api/user/me/` ด้วย ORVA session = 200 พร้อม user
ที่ถูกสร้างอัตโนมัติ (username = email ของ ORVA user)

> ⚠️ **ข้อแลกเปลี่ยนด้านความปลอดภัย**: remote-login เชื่อ header ตรง ๆ — ใครก็ตาม
> ที่เข้าถึง port 8001 ได้โดยตรงปลอม header ได้ **production ห้าม expose 8001**
> ให้รับ traffic จาก ORVA proxy เท่านั้น (dev เปิดไว้เพื่อความสะดวก)
> ถ้าต้องการความแน่นระดับ Horilla (verify JWT ผ่าน JWKS — ปลอมไม่ได้แม้เข้าถึงตรง)
> ค่อยเขียน InvenTree plugin ตรวจ `X-Orva-Identity` เพิ่มทีหลัง

## วิธีรัน (dev)

```bash
docker compose up -d inventree-db inventree
# image ตั้ง INVENTREE_AUTO_UPDATE=true — migrate อัตโนมัติตอน start (ครั้งแรกใช้เวลา ~2-3 นาที)
# admin user ถูกสร้างจาก env: orva-admin / orva-admin-pass
```

ลงทะเบียนกับ ORVA (ต่อ tenant):

```bash
curl -X POST http://127.0.0.1:8080/api/v1/external-modules \
  -H "Authorization: Bearer <token>" -H "content-type: application/json" \
  -d '{"name":"inventree","base_url":"http://localhost:8001"}'
```

## Canonical Product projection

ฝั่ง ORVA พร้อมแล้ว (ADR 0016): event `inventree.product.<created|updated|deleted>`
ที่ publish ผ่าน `POST /api/v1/agent/events` (service key scope
`agent:event:publish`) ถูก project ลงตาราง canonical `products` อัตโนมัติ —
ดูได้ที่ `GET /api/v1/products` (permission `core.product.read`)

payload contract:

```json
{
  "event_type": "inventree.product.created",
  "payload": {
    "source_id": "<part pk>",
    "name": "M3 Bolt", "sku": "BOLT-M3",
    "description": "...", "is_active": true
  }
}
```

### ORVA Event Bridge plugin ✅

implement แล้วที่ [docker/inventree/plugins/orva_events.py](../../docker/inventree/plugins/orva_events.py)
— **plugin ตามระบบ plugin ทางการของ InvenTree** (MIT, mount เข้า `data/plugins`)
ต่อ Django signals บน `Part` ตรง ๆ ตอน plugin โหลด (ไม่พึ่ง background worker):
created/updated/deleted → `inventree.product.*` best-effort (daemon thread,
timeout 3 วิ, log-only — ORVA ล่มไม่ทำ InvenTree พัง)

การเปิดใช้ (ครั้งเดียว):

```bash
# 1) ออก service key (scope agent:event:publish) แล้วตั้ง env
export INVENTREE_ORVA_SERVICE_KEY=<api_key>
docker compose up -d inventree
# 2) plugin โผล่เป็น inactive — activate แล้ว restart
docker exec orva-inventree sh -c 'cd /home/inventree/src/backend/InvenTree && python -c "
import django, os
os.environ.setdefault(\"DJANGO_SETTINGS_MODULE\",\"InvenTree.settings\")
django.setup()
from plugin.models import PluginConfig
PluginConfig.objects.filter(key=\"orvaevents\").update(active=True)"'
docker restart orva-inventree
```

**พิสูจน์แล้ว E2E**: `POST /api/part/` สร้าง Part จริงใน InvenTree →
`GET /api/v1/products` ใน ORVA เห็น canonical row ทันที
(`name/sku(IPN)/description/source_module=inventree/source_id=pk`)

หมายเหตุ: องค์กรที่ provision ก่อน permission `core.product.read` เกิด ต้อง grant
ให้ role เพิ่มเอง (พฤติกรรม M3 เดียวกับ `core.employee.read`)
