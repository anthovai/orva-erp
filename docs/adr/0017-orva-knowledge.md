# ADR 0017 — ORVA Knowledge: linked notes ที่ผูกกับ canonical data

- **สถานะ**: Accepted (2026-08-16)
- **เกี่ยวข้อง**: `knowledge_notes`/`knowledge_links` (migration), crate `orva-knowledge`,
  `/api/v1/knowledge/*`, [ARCHITECTURE.md §9](../ARCHITECTURE.md) (Obsidian = concept เท่านั้น)

## บริบท

แผนแรกเคยคิดใช้ Obsidian เป็น Knowledge Foundation แต่ตรวจ license แล้วใช้ไม่ได้ทั้ง
โค้ดและแอป (proprietary, fork ไม่มี license) — ตัดสินใจตั้งแต่ ARCHITECTURE v0.2 ว่า
**สร้างเองโดยยืมแค่แนวคิด**: linked notes + backlinks + knowledge graph

## การตัดสินใจ

### Syntax เดียว สามเป้าหมาย

เนื้อหาโน้ตอ้างสิ่งอื่นด้วย `[[...]]`:

| รูปแบบ | เป้าหมาย |
|---|---|
| `[[ชื่อโน้ต]]` | โน้ตอื่นในองค์กร (ตามชื่อ, case-insensitive) |
| `[[employee:email]]` | canonical Employee (ADR 0016) |
| `[[product:sku]]` | canonical Product (ADR 0016) |

จุดขายของ ORVA Knowledge เทียบกับ note app ทั่วไป: **ความรู้ผูกกับข้อมูลธุรกิจจริง**
— โน้ต "ทำไมเราเลิกสั่งจาก supplier X" ลิงก์ถึงตัว Product ที่มาจาก InvenTree ได้ตรง ๆ

### Link lifecycle — pending → resolved → pending

- ลิงก์หาโน้ตที่**ยังไม่ถูกเขียน**เก็บเป็น pending (`to_note_id = null`) — เมื่อโน้ต
  ชื่อนั้นถูกสร้างทีหลัง ลิงก์ค้างทุกตัว resolve อัตโนมัติ (ธรรมเนียม wiki/Obsidian)
- ลบโน้ต → ลิงก์ขาเข้ากลับเป็น pending (โผล่ใน graph เป็น node ชนิด `missing` —
  มองเห็นว่าความรู้ตรงไหนหายไป/ยังไม่ถูกเขียน)
- แก้เนื้อหา → ลิงก์ขาออกถูก parse ใหม่ทั้ง set (idempotent)
- parser เขียนเอง ~30 บรรทัด ไม่เพิ่ม dependency (ไม่ใช้ regex crate)

### API + สิทธิ์

- CRUD: `POST/GET /api/v1/knowledge/notes`, `GET/PUT/DELETE /notes/{id}`
  (detail มาพร้อมลิงก์ขาออก + backlinks)
- `GET /api/v1/knowledge/graph` — nodes (`note`/`employee`/`product`/`missing`) + edges
- permission ใหม่: `core.knowledge.read` / `core.knowledge.manage` (seed ใน migration)
- ทุกการเปลี่ยนแปลง publish event `knowledge.note.*` — Intelligence เฝ้าได้ตามปกติ
- ตารางอยู่ใต้ FORCE RLS ตามกติกา ADR 0005

## ผลลัพธ์

- พิสูจน์ใน `core/tests/knowledge_flow.rs`: ลิงก์ค้าง → resolve เมื่อโน้ตปลายทางเกิด,
  backlinks, entity links, graph (รวม missing node หลังลบ), ชื่อซ้ำ → 400,
  แก้เนื้อหา → re-parse + unit tests ของ parser
- สิ่งที่ยังไม่ทำ (ตั้งใจ): full-text search, การ validate ว่า entity ref มีจริง
  (ลิงก์ entity เป็น reference-by-value — สะกดผิดก็เก็บ ไว้เช็คตอน render),
  graph visualization ใน UI (endpoint พร้อมแล้ว), embedding/semantic search
  (รอ Intelligence Phase AI)
