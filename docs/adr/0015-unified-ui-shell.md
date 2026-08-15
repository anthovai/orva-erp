# ADR 0015 — Unified UI Shell v0.1: embed ใน binary ไม่มี build step

- **สถานะ**: Accepted (2026-08-15)
- **เกี่ยวข้อง**: `core/ui/index.html`, `GET /ui` (root `/` redirect มา)

## บริบท

ORVA Core มี API ครบทุกระบบ (auth/MFA, workflow+approval, notification+SSE,
intelligence+recommendation, modules ทั้ง compiled และ external) แต่ยังไม่มีหน้าจอ
ให้มนุษย์ใช้เลย — ทุกอย่างต้อง curl ตัวเลือกใหญ่คือ SPA framework (React/Vue —
ต้องมี Node toolchain + build pipeline) vs ของที่ประกอบเข้า single binary ได้ทันที

## การตัดสินใจ

### v0.1 = ไฟล์เดียว embed ใน binary

- `core/ui/index.html` — HTML/CSS/JS self-contained ~600 บรรทัด **ไม่มี dependency
  ภายนอกแม้แต่ตัวเดียว** (ไม่มี CDN, ไม่มี npm, ไม่มี build step)
- เสิร์ฟด้วย `include_str!` ที่ `GET /ui` — UI เดินทางไปกับ binary เสมอ deploy คือ
  copy ไฟล์เดียวเหมือนเดิม (สอดคล้องปรัชญา single-binary ของ ADR 0001/0004)
- เหตุผลเชิงปฏิบัติ: เครื่อง dev ปัจจุบันไม่มี Node toolchain และ UI ระดับ shell
  ยังไม่ซับซ้อนพอจะคุ้มค่า framework — **เมื่อ UI โตเกิน ~2,000 บรรทัดหรือต้องมี
  component reuse จริงจัง ให้ย้ายเป็น SPA แยก repo/pipeline** (บันทึกไว้เป็นเงื่อนไข
  ยกระดับชัดเจน ไม่ใช่ตัดสินใจถาวร)

### ขอบเขต v0.1 (ครอบทุกระบบของ Core)

| หน้า | ใช้ API |
|---|---|
| Login / สร้างองค์กร (+ช่อง MFA โผล่อัตโนมัติเมื่อ 400 `totp_code required`) | auth/login, organizations |
| Dashboard | recommendations (accept/dismiss — accept โชว์ workflow ที่เกิด), insights |
| งานรออนุมัติ (badge นับสด) | approval-tasks/mine, approve/reject |
| การแจ้งเตือน (badge unread + toast real-time) | notifications list/read + **SSE stream** |
| Modules | modules (compiled) + external-modules (register/enable/disable) |
| ตั้งค่า | MFA setup/activate, per-tenant rate limit |

### รายละเอียดเทคนิคที่ตั้งใจ

- token เก็บใน `localStorage` แล้วแนบ `Authorization: Bearer` — **SSE ใช้ fetch
  stream reader ไม่ใช่ `EventSource`** เพราะ EventSource ใส่ header ไม่ได้
- 401 กลางทาง = เด้งออกหน้า login (session หมดอายุ)
- ทุกค่าจาก API ผ่าน HTML-escape ก่อน render (กัน XSS จากข้อมูลใน DB)

## ผลลัพธ์

- ยืนยันด้วยการคลิกจริงในเบราว์เซอร์ครบ loop: สร้างองค์กรผ่านฟอร์ม → Dashboard →
  trigger approval จาก API ภายนอก → **badge เด้ง real-time ผ่าน SSE** → กดอนุมัติ
  ใน UI → รายการเคลียร์ → notifications/modules/settings render ครบ
  (+ test `ui_shell_is_served` กัน regression ระดับ serve)
- สิ่งที่ยังไม่ทำ (ตั้งใจ): หน้า workflow definitions/intelligence rules แบบ CRUD เต็ม,
  QR code render สำหรับ MFA (โชว์ secret + otpauth URI แทน), i18n จริง (ตอนนี้
  label ไทยฝังตรง ๆ), refresh token (ตอนนี้ session 24 ชม. หมดแล้ว login ใหม่)
