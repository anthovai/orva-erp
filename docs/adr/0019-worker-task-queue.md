# ADR 0019 — ORVA Worker task queue: pull-based dispatch ไปยัง Execution Plane

**Status:** Accepted (2026-08-16)

## Context

ARCHITECTURE.md §12 แบ่ง ORVA เป็น Control Plane (Rust core) และ Execution Plane
(ORVA Worker = OpenWorker) แต่ที่ผ่านมาการเชื่อมเป็น **ทางเดียว**: worker เรียกเข้า
ORVA ได้ (Agent API — `agent/context`, `agent/workflows`, `agent/events` และ
connector ฝั่ง OpenWorker commit `c10e4db`) ส่วน ORVA **สั่งงาน worker ไม่ได้**
insight/recommendation ที่มนุษย์ accept แล้วจึงจบลงที่ "รู้ว่าควรทำ" โดยไม่มีใครลงมือ

ข้อจำกัดสำคัญ: OpenWorker รันบนเครื่องผู้ใช้/เครื่องในองค์กร หลัง NAT ไม่มี URL
ให้ ORVA ยิงเข้า — จะออกแบบเป็น webhook/push ไม่ได้

## Decision

1. **คิวงานในฐานข้อมูล + pull model** — ตาราง `worker_tasks` (FORCE RLS ตาม ADR 0005)
   ORVA เขียนงานเข้าคิว, worker **poll** เอาเองผ่าน Agent API (ไม่ต้องเปิด inbound
   port ที่ฝั่ง worker และเปลี่ยนเครือข่าย/ย้ายเครื่องได้โดยไม่ต้อง config อะไรใน ORVA)
2. **วงจรสถานะชัดเจน**: `pending` → worker claim → `running` → รายงานผล →
   `succeeded`/`failed`; หรือ `cancelled` ถ้ามนุษย์ยกเลิกก่อนถูก claim
   งานที่ worker ลงมือแล้วยกเลิกไม่ได้ (ไม่มีทางสั่งให้ worker หยุดกลางคัน — ยอมรับตรง ๆ ดีกว่า
   บอกว่ายกเลิกแล้วทั้งที่ยังทำอยู่)
3. **Claim เป็น atomic ที่ระดับ DB** — `update ... where status = 'pending' returning *`
   ทำให้ worker หลายตัว poll คิวเดียวกันพร้อมกันได้ ตัวที่ช้ากว่าได้ **409** แล้วไป claim
   ชิ้นถัดไป (ไม่ต้องมี lock/leader election)
4. **สองฝั่งใช้คนละ auth ตามธรรมชาติของมัน** — ฝั่งมนุษย์: session + permission
   `core.worker.read` / `core.worker.manage`; ฝั่ง worker: service identity
   (`X-Orva-Service-Key`) + scope ใหม่ `agent:task:read` (อ่านคิว) และ
   `agent:task:write` (claim + รายงานผล) แยกกันเพื่อออก key แบบอ่านคิวอย่างเดียวได้ (ADR 0011)
5. **ปิดวงจรกลับหามนุษย์** — เมื่อ worker รายงานผล คนที่สั่งงานได้ notification ทันที
   (ผ่าน SSE ของ ADR 0013 อยู่แล้ว) และทุกก้าวลง event log
   (`worker.task.created` / `.claimed` / `.completed` / `.cancelled`)
6. **ต่อกับ Intelligence** — recommendation ที่มี `suggested_action`
   `{"type":"worker","instruction":"..."}` เมื่อมนุษย์กด accept จะสร้างงานเข้าคิวให้
   (source = `recommendation`) ปิดวงจรเต็ม: **event/AI → insight/ข้อเสนอ → มนุษย์อนุมัติ
   → worker ลงมือ → ผลกลับมาที่ ORVA**

## Consequences

- ORVA เป็นผู้สั่งงานได้จริงโดยไม่ต้องรู้ว่า worker อยู่ที่ไหน — worker ตัวใหม่แค่ถือ key
  ที่มี scope ก็เข้ามารับงานได้ทันที
- ต้องรับ latency ของการ poll (worker เลือกเองว่าถี่แค่ไหน) — ยอมแลกกับการไม่ต้องมี
  inbound connectivity; ถ้าอนาคตต้องการ near-real-time ค่อยเพิ่ม long-poll/SSE
  บน endpoint เดิมได้โดยไม่เปลี่ยน data model
- ยังไม่มี: การ retry งานที่ worker claim แล้วหายไป (ไม่มี lease timeout), งานตามตาราง
  เวลา, การส่ง artifact ไฟล์กลับ (ตอนนี้ผลเป็นข้อความ) — เว้นไว้จนกว่าจะมีการใช้จริง
- ฝั่ง OpenWorker ยังต้องเพิ่ม tool ที่ poll/claim/report (connector เดิมมีแค่ฝั่งเรียกเข้า
  ORVA) — สัญญา API ฝั่ง ORVA พร้อมและมี OpenAPI ให้แล้ว
