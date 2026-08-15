# ADR 0013 — Real-time Notification Push ด้วย SSE (ไม่ใช่ WebSocket)

- **สถานะ**: Accepted (2026-08-15) — ปิด known gap "real-time notification push" ของ M6
- **เกี่ยวข้อง**: `orva_notifications::NotificationHub`, `GET /api/v1/notifications/stream`

## บริบท

in-app notification เป็นแถวใน DB ที่ client ต้อง poll `GET /api/v1/notifications` เอง —
Unified UI ในอนาคต (และ integration ปัจจุบัน) ควรได้รับ notification ทันทีที่เกิด

## การตัดสินใจ

### SSE ไม่ใช่ WebSocket

Notification เป็นการสื่อสาร**ทางเดียว** (server → client) — SSE พอดีเป๊ะ:
HTTP ธรรมดา (ผ่าน proxy/auth ชั้นเดิมหมด รวม rate limit สองชั้น), reconnect
ในตัวของ `EventSource`, ไม่ต้องมี protocol upgrade WebSocket ค่อยพิจารณาเมื่อมี
use case สองทาง (เช่น collaborative editing)

### สถาปัตยกรรม

- `NotificationHub` — tokio `broadcast` channel ตัวเดียว (capacity 256) ใน
  orva-notifications; `NotificationService.notify` publish ทุก in_app notification
  **หลังบันทึกแถวสำเร็จแล้วเสมอ**
- `GET /api/v1/notifications/stream` (auth ปกติ) — subscribe hub แล้วกรองเฉพาะ
  `organization_id` + `user_id` ของผู้เรียกที่ฝั่ง server (broadcast เป็น channel
  กลางข้าม tenant แต่การกรองเกิดก่อนออกจาก process เสมอ), keep-alive ทุก 15 วิ
- event ชื่อ `notification`, payload = JSON shape เดียวกับ list endpoint

### Best-effort โดยเจตนา — DB คือ source of truth

- subscriber เห็นเฉพาะ notification ที่เกิด**หลัง** subscribe
- subscriber ช้าเกิน capacity → ข้าม message (ไม่ block ผู้ส่ง)
- client ที่หลุด/พลาด sync กลับด้วย `GET /api/v1/notifications` ได้เสมอ —
  stream เป็นตัวเร่งความไว ไม่ใช่กลไก delivery guarantee
- in-process ตาม ADR 0003 — scale หลาย replica ต้องย้าย hub ไป broker ภายนอก
  พร้อมกับ Event Bus

## ผลลัพธ์

- พิสูจน์ใน `core/tests/notification_stream.rs` — subscribe ก่อน, trigger workflow
  approval จริง, event ไหลออกมาใน stream ภายใน 5 วิโดยไม่ poll DB + ยืนยัน manual
  ด้วย `curl -N` กับ server จริง (เห็น `event: notification` + payload ทันที)
- สิ่งที่ยังไม่ทำ (ตั้งใจ): `Last-Event-ID` resume (client sync ผ่าน list แทน),
  push ข้าม replica, push channel อื่น (webhook/mobile push)
