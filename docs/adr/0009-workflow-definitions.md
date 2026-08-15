# ADR 0009 — Reusable Workflow Definitions (copy-on-create)

- **สถานะ**: Accepted (2026-08-15) — ปิด known gap "workflow definition แบบ reusable" ของ M6
- **เกี่ยวข้อง**: `workflow_definitions` (migration), `orva_workflow::WorkflowService`,
  `/api/v1/workflow-definitions`

## บริบท

M6 ให้ผู้เรียกส่ง `rule` inline มากับทุก instance — ใช้ได้แต่ตั้งค่านโยบายซ้ำทุกครั้ง
และ agent/module ที่อยากทำตาม "นโยบายที่องค์กรตั้งไว้" ไม่มีอะไรให้อ้างอิง

## การตัดสินใจ

### Definition = template ต่อ tenant

ตาราง `workflow_definitions`: `name` (unique ต่อ org), `resource_type`, `rule` (jsonb,
optional), `default_approver_id` (optional), `enabled` — อยู่ใต้ RLS เหมือนตาราง
tenant-scoped อื่น (ตารางใหม่ทุกตารางต้องทำเอง — ADR 0005)

### Copy-on-create ไม่ใช่ reference-at-evaluate

สร้าง instance จาก definition = **copy** `resource_type`/`rule` ลง instance ณ ตอนสร้าง
(instance จำ `definition_id` ไว้เพื่อ audit/fallback เท่านั้น) — แก้ definition ทีหลัง
**ไม่กระทบ instance ที่วิ่งอยู่** เหตุผล: การเปลี่ยนกติกากลางคันกับ instance ที่กำลังรอ
อนุมัติเป็นพฤติกรรมที่คาดเดายาก และ audit ต้องรู้ว่า instance นี้ตัดสินด้วย rule เวอร์ชันไหน

### API

- `POST/GET /api/v1/workflow-definitions` (permission `core.workflow.manage`)
- `POST /api/v1/workflows` รับ **อย่างใดอย่างหนึ่ง**:
  - `definition_id` (ห้ามส่ง `rule`/`resource_type` ร่วม — 400)
  - `resource_type` + `rule` inline แบบเดิม (backward compatible 100%)
- definition ที่ `enabled = false` สร้าง instance ไม่ได้ (400)

### Default approver fallback

`advance` โดยไม่ระบุ `approver_id`: ถ้า instance มาจาก definition ที่มี
`default_approver_id` → ใช้คนนั้นอัตโนมัติ; ไม่มีทั้งคู่ → 400 เหมือนเดิม
ระบุ `approver_id` มาเอง → ชนะ default เสมอ

## ผลลัพธ์

- พิสูจน์ใน `core/tests/workflow_flow.rs::definition_based_workflow_uses_stored_rule_and_default_approver`
  (definition → instance → advance ไม่ระบุ approver → default approver ได้ task → approve)
  + ยืนยัน manual กับ server จริง
- สิ่งที่ยังไม่ทำ (ตั้งใจ): update/disable definition ผ่าน API (repository มี
  `set_enabled` แล้วแต่ยังไม่ expose), multi-step approval chain (definition เดียว
  = ขั้นอนุมัติเดียว), Agent API ยังรับเฉพาะ inline rule (ค่อยเพิ่ม `definition_id`
  ตอนทำ fine-grained agent scope)
