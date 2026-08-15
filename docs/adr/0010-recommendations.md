# ADR 0010 — Recommendation: ข้อเสนอที่มนุษย์ตัดสิน ไม่ใช่ action อัตโนมัติ

- **สถานะ**: Accepted (2026-08-15) — ปิด known gap "Recommendation entity" ของ M8
- **เกี่ยวข้อง**: `recommendations` (migration), `intelligence_rules.recommended_action`,
  `/api/v1/recommendations`

## บริบท

M8 จบที่ Insight (ข้อสังเกต append-only) — ARCHITECTURE.md §9 วางลำดับไว้ว่า
Context → Insight → **Recommendation** → Action ตอนนี้มี Workflow Definitions
(ADR 0009) แล้ว จึงปิดวงจรได้จริง: สิ่งที่ engine แนะนำสามารถกลายเป็น workflow
ที่ผ่านขั้นอนุมัติตามปกติ

## การตัดสินใจ

### หลักการ: engine เสนอ มนุษย์ตัดสิน

- `IntelligenceRule` เพิ่ม `recommended_action` (jsonb, optional) — rule ที่มีค่านี้
  เมื่อ trigger จะสร้าง `Recommendation` (สถานะ `pending`) ควบคู่กับ Insight
- **Engine ไม่ execute action เองเด็ดขาด** — Recommendation รอมนุษย์
  `accept`/`dismiss` เท่านั้น (ตัดสินได้ครั้งเดียว — decide เป็น conditional update
  `where status = 'pending'` กัน race/ตัดสินซ้ำ)

### Accept = สร้าง workflow ไม่ใช่ทำ action ตรง ๆ

- `suggested_action` เป็น jsonb opaque — **core เป็นคน interpret ตอน accept**
  (intelligence layer ไม่รู้จัก workflow — ไม่มี dependency ข้าม crate)
- type ที่รู้จักตอนนี้: `{"type":"workflow","definition_id":"...","context":{...}}`
  → accept สร้าง instance จาก definition (ADR 0009) โดย resource = ตัว
  recommendation เอง แล้วเก็บ `resulting_workflow_id` ไว้ตาม
- ผลลัพธ์: แม้ accept แล้ว action จริงยังต้องผ่าน approval chain ของ
  Workflow Engine ตามปกติ — สอดคล้องปรัชญา "agent/intelligence เสนอ มนุษย์อนุมัติ"
  เดียวกับ ORVA Agent API (M8)

### API

- `GET /api/v1/recommendations?status=` — permission `core.insight.read`
- `POST /{id}/accept`, `POST /{id}/dismiss` — permission `core.intelligence.manage`
- ทุกการตัดสินใจ publish event (`recommendation.accepted`/`dismissed`) เข้า audit log

## ผลลัพธ์

- พิสูจน์เต็มวงจรใน `core/tests/intelligence_flow.rs::recommendation_accept_creates_workflow_from_definition`
  (rule + recommended_action → user สมัครจริง → recommendation เกิด → accept →
  workflow instance จาก definition มีจริง → ตัดสินซ้ำได้ 400) + ยืนยัน manual
- สิ่งที่ยังไม่ทำ (ตั้งใจ): action type อื่นนอกจาก `workflow`, การ dedupe
  recommendation ซ้ำจาก rule เดียวกันที่ trigger ถี่ ๆ (ตอนนี้เกิดทุกครั้งที่ trigger),
  notification แจ้งว่ามี recommendation ใหม่ (ใช้ `notify_user_id` ของ rule ได้แต่ยัง
  ผูกกับ insight เท่านั้น)
