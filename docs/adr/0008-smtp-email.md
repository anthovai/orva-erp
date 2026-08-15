# ADR 0008 — ส่งอีเมลจริงทาง SMTP (lettre + rustls)

- **สถานะ**: Accepted (2026-08-15) — ปิด known gap "email แค่บันทึกแถว" ของ M6
- **เกี่ยวข้อง**: `orva_notifications::mailer`, migration `notification_delivery`, config `[email]`

## บริบท

M6 สร้าง notification 2 channel (`in_app` เต็มรูปแบบ, `email` บันทึกแถวอย่างเดียว)
ตอนนี้ workflow approval ใช้งานจริงแล้ว (รวมถึงจาก ORVA Agent API) — ผู้อนุมัติ
ควรได้อีเมลจริง ไม่ใช่แค่แถวใน DB ที่ต้อง login มาดูเอง

## การตัดสินใจ

### Mailer abstraction

- trait `Mailer` (boxed future — pattern เดียวกับ `orva_module_sdk::Module`)
  + `SmtpMailer` implement ด้วย **lettre 0.11** — บังคับ **rustls เท่านั้น**
  (`default-features = false`) เพราะเครื่อง dev/CI ไม่มี native-tls toolchain
- `NotificationService::with_mailer(pool, Option<Arc<dyn Mailer>>)` —
  `None` = พฤติกรรมเดิม (บันทึกแถว ไม่ส่ง) ทำให้ dev/test ที่ไม่สน email ไม่ต้องตั้งอะไร

### Configuration (opt-in ทั้งหมด)

- section `[email]` ใน config หรือ env: `ORVA_SMTP_HOST` (บังคับคู่กับ
  `ORVA_SMTP_FROM`), `ORVA_SMTP_PORT` (default 587), `ORVA_SMTP_USERNAME`/`PASSWORD`,
  `ORVA_SMTP_TLS` (default true = STARTTLS; ปิดได้เฉพาะ dev)
- ไม่ config = server log บอกชัดว่า "recorded but not sent"

### Delivery semantics

- ส่ง**หลัง**บันทึกแถว notification เสมอ — ตาราง `notifications` เป็น source of truth
- **การส่งล้มเหลวไม่ทำให้ notify ล้มเหลว** (workflow ไม่ควรพังเพราะ SMTP ล่ม)
  — mark `delivery_status = 'failed'` + `delivery_error` ไว้ตรวจ/replay ทีหลัง
- สถานะ: `created` → `sent` (+`delivered_at`) หรือ `failed` (+`delivery_error`)
- ผู้รับ = email ของ user เจ้าของ notification (lookup จาก `users`)
- ส่งแบบ inline await ใน `notify()` พร้อม timeout 10 วินาที — ยังไม่มี background
  queue (ดู gap ด้านล่าง)

### Dev environment

- docker-compose เพิ่ม **Mailpit** (`orva-mailpit`): SMTP `:1025`, Web UI + REST `:8025`
- ทดสอบจริง: ตั้ง `ORVA_SMTP_HOST=localhost ORVA_SMTP_PORT=1025 ORVA_SMTP_TLS=false
  ORVA_SMTP_FROM="ORVA <no-reply@orva.local>"` แล้วดูเมลที่ `http://localhost:8025`

## ผลลัพธ์

- พิสูจน์อัตโนมัติ: `crates/orva-notifications/tests/wiring.rs` (RecordingMailer —
  ส่งถึง email ถูกคน + mark `sent` / SMTP ล่ม → notify ไม่ล้ม + mark `failed`)
- พิสูจน์ E2E จริง: workflow approval บน server จริง → อีเมลถึง Mailpit
  (From/To/Subject ครบ) + แถวใน DB เป็น `sent`
- สิ่งที่ยังไม่ทำ (ตั้งใจ):
  - **Background queue + retry** — ตอนนี้ส่ง inline ใน request path (timeout 10s
    คุมความเสียหาย) ถ้าปริมาณอีเมลโตค่อยย้ายเป็น queue ที่ replay แถว `failed` ได้
  - **HTML template** — ส่ง plain text ล้วน
  - `delivery_status` ยังไม่โผล่ใน API response ของ `/api/v1/notifications`
    (เป็นข้อมูล ops มากกว่า end-user)
