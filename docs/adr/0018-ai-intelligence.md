# ADR 0018 — AI ใน Intelligence Engine: Analyst ที่เสนอ ไม่ execute

**Status:** Accepted (2026-08-16)

## Context

Intelligence Engine เดินมาตามแผน rules → analytics → AI (ARCHITECTURE.md §9):
M8 วาง rule-based engine (event → threshold → insight), ADR 0010 เพิ่ม
recommendation ที่มนุษย์ accept/dismiss ขั้นสุดท้ายของ Phase-next คือชั้น AI จริง —
ให้ผู้ใช้ถามคำถามเชิงวิเคราะห์กับข้อมูลองค์กร และให้ AI เสนอ action ได้เอง
โดยไม่ทิ้งหลักการ human-in-the-loop

Rust ไม่มี official Anthropic SDK — ต้องเรียก Messages API ตรง (raw HTTP)

## Decision

1. **Trait `Analyst` ใน orva-intelligence** — dyn-safe (`analyze(context, question)
   -> BoxFuture<Result<AiAnalysis>>`) เพื่อให้ core ฉีด stub ใน test ได้
   CI ไม่แตะ network เด็ดขาด implementation จริงคือ `ClaudeAnalyst`
2. **`ClaudeAnalyst` = raw HTTP ผ่าน reqwest** ไปยัง `POST /v1/messages`
   (anthropic-version 2023-06-01) — model default `claude-opus-5`
   (override ได้ผ่าน config/env) พร้อม **structured output**
   (`output_config.format` แบบ `json_schema`) บังคับรูป
   `{analysis: string, recommendation: {title, description} | null}`
   จึง parse ได้เสมอไม่ต้องเดา และ handle `stop_reason: refusal` เป็น error ชัดเจน
3. **Context ที่ส่งให้ AI ประกอบที่ชั้น core** (`gather_context`) — สรุปตัวเลขจากระบบจริง:
   count ของ event ต่อชนิดย้อนหลัง 7 วัน (ไม่ส่ง payload ดิบ), insights ล่าสุด,
   pending recommendations, จำนวน canonical employees/products —
   จำกัดข้อมูลที่ออกนอกระบบให้เป็น aggregate เท่าที่จำเป็น
4. **AI เสนอเท่านั้น** — ถ้า AI คืน recommendation, core บันทึกเป็นแถวใน
   `recommendations` ด้วย `source = 'ai'` (คอลัมน์ใหม่; `insight_id`/`rule_id`
   ผ่อนเป็น nullable เพราะไม่ได้มาจาก rule) แล้วเข้า loop accept/dismiss
   ของ ADR 0010 ตามปกติ — เส้นแบ่ง "intelligence เสนอ, มนุษย์ตัดสิน, core execute"
   ไม่ขยับแม้แต่นิดเดียว
5. **เปิด-ปิดด้วย config** — section `[ai]` (`api_key`, `model`) หรือ env
   `ORVA_AI_API_KEY`/`ANTHROPIC_API_KEY` + `ORVA_AI_MODEL`; ไม่ config =
   `POST /api/v1/intelligence/analyze` ตอบ 400 พร้อมคำอธิบาย (แบบเดียวกับ SMTP ใน ADR 0008)
6. **API**: `POST /api/v1/intelligence/analyze` `{question?}` (permission
   `core.intelligence.manage`) → `{analysis, recommendation?}` และ publish event
   `intelligence.analysis.completed` ลง event log ทุกครั้ง (audit trail)

## Consequences

- ผู้ใช้ถามภาษาไทย/อังกฤษกับข้อมูลองค์กรได้จริง และ AI-recommendation แสดงใน
  dashboard ปะปนกับ rule-recommendation (ต่างกันที่ field `source`)
- ค่าใช้จ่าย API เกิดเฉพาะเมื่อผู้ใช้กดถาม (on-demand) — ไม่มี background call
- ช่องว่างที่ตั้งใจเว้น: AI enrich insight อัตโนมัติเมื่อ rule trigger,
  `suggested_action` แบบ workflow จาก AI, streaming คำตอบ, การ cache context —
  รอสัญญาณการใช้งานจริง
- แถว recommendation จาก AI ไม่มี insight/rule ให้ trace — เหตุผลอยู่ใน
  `description` และ event `intelligence.analysis.completed` แทน
