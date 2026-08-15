# ADR 0003 — Event Bus: In-Process ก่อน ไม่ใช้ Broker ภายนอก

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

[ADR 0001](0001-core-technology-stack.md) ทิ้งการตัดสินใจเรื่อง Event Bus ไว้ว่า "จะเริ่มแบบ in-process ก่อน — การเลือก broker ภายนอก (NATS ฯลฯ) เป็น ADR แยกเมื่อถึง M5" ตอนนี้ถึง M5 แล้ว ต้องตัดสินใจจริง

ณ จุดนี้ ORVA Core ยังรันเป็น binary เดียว (`orva-core`) ไม่มี module แยก process ให้สื่อสารข้าม network จริง (Module System เป็น M7 ที่ยังไม่ถึง) และ subscriber ทั้งหมดที่มีอยู่ (ถ้ามี) จะอยู่ใน process เดียวกันไปอีกระยะหนึ่ง

## Decision

ใช้ **in-process pub/sub** (`crates/orva-events`) ไม่ใช้ broker ภายนอก (NATS/RabbitMQ/Kafka) ใน v0.1:

1. `EventBus` เป็น struct ธรรมดาถือ `Arc<RwLock<HashMap<...>>>` สำหรับ subscriber registry — ไม่มี network hop
2. Event ทุกตัว **persist ลง PostgreSQL ก่อนเสมอ** (ผ่าน `EventRepository`) แล้วค่อยแจ้ง subscriber — event log ในฐานข้อมูลคือ source of truth ไม่ใช่ subscriber ที่ได้รับ
3. Dispatch แบบ synchronous (await subscriber ทีละตัวเรียงตามลำดับ subscribe) — subscriber ช้าจะหน่วง `publish()` แต่ทำให้ทดสอบ/debug ง่ายและ ordering คาดเดาได้ ต่างจาก fire-and-forget ที่ ordering ไม่แน่นอน
4. Retry แบบง่าย: 3 ครั้งต่อ subscriber ไม่มี backoff จริง ถ้า fail ครบก็ log แล้วปล่อยผ่าน (ไม่ทำให้ `publish()` fail) เพราะ event ถูก persist แล้วตั้งแต่ต้น — ใครพลาดสามารถ query event log ย้อนหลังมา reconcile เองได้

## Consequences

- **ข้อดี:** ไม่มี infrastructure เพิ่ม (ไม่ต้องรัน NATS/RabbitMQ ใน dev/CI), debug ง่าย, latency ต่ำ (ไม่มี network hop), เหมาะกับ M5 ที่ยังเป็น monolith เดียว
- **ข้อจำกัดที่ต้องแก้ทีหลัง (ไม่ใช่ตอนนี้):**
  - ถ้า scale เป็นหลาย `orva-core` instance (horizontal scale) subscriber ใน instance หนึ่งจะไม่เห็น event ที่ publish จาก instance อื่น — event bus แบบ in-process ไม่ share ข้าม process ต้องย้ายไป broker ภายนอกตอนนั้น
  - เมื่อ Module System (M7) ทำให้ module รันเป็น service แยกจริง (เช่น Horilla, InvenTree ตามที่วางแผนไว้ใน [OSS-STRATEGY.md](../OSS-STRATEGY.md)) module เหล่านั้นจะ**ไม่สามารถ subscribe ผ่าน in-process bus นี้ได้เลย** เพราะอยู่คนละ process/ภาษา — ต้องมี **event bus แบบ network-reachable** (NATS/RabbitMQ หรือ webhook-based) เป็น ADR แยกตอนนั้น ไม่ใช่ตอนนี้
  - Dispatch แบบ synchronous ทำให้ publisher รอ subscriber ทำงานเสร็จ — ถ้า subscriber ในอนาคตทำงานหนัก (เช่นเรียก AI Intelligence Engine) ต้องพิจารณาเปลี่ยนเป็น async fan-out (`tokio::spawn` ต่อ subscriber) ตอนนั้น
- **สรุป:** ADR นี้ตั้งใจให้ถูก "แทนที่" เมื่อถึง M7 หรือเร็วกว่านั้นถ้าจำเป็น ไม่ใช่การตัดสินใจถาวร
