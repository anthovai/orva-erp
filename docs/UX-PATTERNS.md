# Orva UX patterns — actions live on the record

อ้างอิงจากการสำรวจ ERP ที่คนไทยและ SME ใช้จริง (2026-09-01) เพื่อเป็นแนวทาง
ของ**ทุก**ฟีเจอร์ที่จะเพิ่มเข้ามา ไม่ใช่เฉพาะเอกสาร

## สิ่งที่ ERP อ้างอิงทำเหมือนกัน

| ระบบ | สิ่งที่เห็น |
|---|---|
| Odoo | ปุ่ม **Preview** อยู่บนฟอร์มใบเสนอราคาเอง — เปิดมุมมองที่ลูกค้าจะเห็นจริง แล้วสั่งพิมพ์/ดู PDF จากตรงนั้น |
| QuickBooks | ปุ่ม **Print or Preview** อยู่บนหน้าใบแจ้งหนี้ — โชว์ PDF ให้ดูก่อนกด Save and send |
| FlowAccount | เอกสารต่อเนื่อง (ใบเสนอราคา → ใบแจ้งหนี้ → ใบกำกับภาษี/ใบเสร็จ) สร้างจาก**แถวเอกสารเดิม** ข้อมูล sync ต่อให้เอง ไม่ต้องกรอกซ้ำ |

ข้อสรุปเดียวกันทั้งสามระบบ: **คำถามของผู้ใช้เกิดตอนกำลังดู record
("ใบนี้จะหน้าตายังไง / ส่งยัง / ออกใบกำกับต่อได้มั้ย") — คำตอบจึงต้องอยู่บน
record นั้น** ไม่ใช่ในเมนูเครื่องมือแยกที่ต้องไปหา record ซ้ำอีกรอบ

## กฎที่ใช้กับงานทุกชิ้นใน Orva

1. **Action อยู่บน record** — ฟีเจอร์ที่กระทำกับเอกสาร/ลูกค้า/พนักงานรายตัว
   ต้องมีปุ่มบนหน้า detail ของสิ่งนั้น (ผ่าน injection spot ของ upstream
   เช่น `sales.document.detail.{kind}:{surface}`) หน้ารวมในเมนูมีไว้เป็น
   ทางเข้าสำรองและงาน batch เท่านั้น
2. **Review ก่อน side effect เสมอ** — ก่อนพิมพ์/ส่ง/โพสต์บัญชี ผู้ใช้ต้องเห็น
   สิ่งที่จะเกิดจริง (แผ่นเอกสารจริง ไม่ใช่ summary) พร้อมคำเตือน compliance
   ในที่เดียวกัน
3. **สิ่งที่ preview คือสิ่งที่ได้** — จอ review, หน้า print และ PDF
   ฝั่งเซิร์ฟเวอร์ ต้อง render จาก component/ข้อมูลชุดเดียวกัน
   (orva_documents ทำแบบนี้อยู่: dialog, หน้า preview และ Chromium
   พิมพ์เทมเพลตเดียวกัน)
4. **งานต่อเนื่องไหลจากเอกสารเดิม** — ใบเสนอราคาออกใบกำกับภาษีต่อได้จาก
   หน้าตัวเอง ไม่ต้อง re-enter (แบบ FlowAccount) — ใช้หลักนี้กับ flow อื่น
   เช่น รับชำระจากใบแจ้งหนี้, จ่ายจากบิลผู้ขาย
5. **Dialog สำหรับดู, หน้าเต็มสำหรับทำ** — review ใน dialog บน record;
   การพิมพ์ (print CSS ซ่อน dialog โดยตั้งใจ) และการส่งอีเมล ใช้หน้าเต็ม
   ที่ลิงก์จาก dialog

## ตัวอย่างที่ implement แล้ว

- หน้าใบเสนอราคา → ปุ่ม "ตรวจดูเอกสาร" **ด้านบนของหน้า ใต้แถบหัวเรื่อง**
  (spot `form-header:detail`, gate ด้วย path) → dialog แสดงแผ่น A4 จริง
  สลับประเภท/เทมเพลตได้ ดาวน์โหลด PDF ได้ พร้อมคำเตือนเลขผู้เสียภาษี
  (`orva_documents/widgets/injection/quote-documents` +
  `components/DocumentReviewDialog.tsx`)
- หน้า "ตัวอย่างเอกสาร" ถูกซ่อนจากเมนู (`navHidden`) — เข้าถึงจาก record
  เท่านั้น เหลือ "ตั้งค่าเอกสาร" ในเมนูการขายตามเดิม
- แถวในรายการใบเสนอราคา → เมนู kebab มี ตรวจดูเอกสาร (พิมพ์ใบเสนอราคา)
  และ ออกใบแจ้งหนี้งวด (เปิดใบพร้อม dialog ออกงวด)
  (`orva_documents/widgets/injection/quote-row-documents`)
- **รับชำระจากใบแจ้งหนี้** (กฎข้อ 4 อีกตัวอย่าง): ปุ่ม "บันทึกรับชำระ" อยู่บน
  แถวใบแจ้งหนี้และบนรายการงวดในหน้าใบเสนอราคา — dialog คำนวณหัก ณ ที่จ่าย 3%
  ของยอดก่อน VAT ให้ (เงินสด + WHT = ปิดยอด) แสตมป์วันที่รับชำระให้ใบเสร็จ
  พิมพ์ต่อได้ทันที ใช้ optimistic lock (updatedAt → 409)
  (`orva_documents/api/record-payment` + `components/RecordPaymentDialog.tsx`)
- **หนึ่งบิล สองชนิด record**: ใบเสนอราคาพิมพ์ได้เฉพาะใบเสนอราคา;
  เอกสารเรียกเก็บ (ใบแจ้งหนี้/ใบกำกับภาษี/ใบเสร็จ) พิมพ์จากใบแจ้งหนี้ที่
  "ออกงวด" จากใบเสนอราคา (dialog % ของยอด → mint เลขซีรีส์ KK-INV
  อัตโนมัติ → สร้าง record จริงผูกกลับใบเสนอราคา + งวดที่ N) — API บังคับ
  กติกานี้ (พิมพ์ข้ามชนิด = 400)

Sources: [Odoo — Create and send quotations](https://www.odoo.com/documentation/19.0/applications/sales/crm/acquire_leads/send_quotes.html),
[QuickBooks — invoice preview](https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/does-anyone-know-what-happened-to-the-invoice-preview-before/00/228739),
[FlowAccount — ใบเสนอราคา](https://flowaccount.com/blog/quotaion-basic-knowledge/)
