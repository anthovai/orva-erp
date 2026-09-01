# Orva Brand / CI System

แนวทางอัตลักษณ์แบรนด์ของ Orva — ยึดตามนี้ทุกครั้งที่แตะ UI, หน้า marketing,
เอกสาร, หรือ asset ใหม่ (บันทึกจาก brand direction review, 2026-08-30)

## Positioning

> **Orva — The Open Platform for Modern Business**

- ไม่ล็อกตัวเองว่าเป็นแค่ ERP — เป็น business platform ที่ ERP คือแกน
- CI ต้องสื่อว่า "นี่คือผลิตภัณฑ์ของ Anthovai" ไม่ใช่ "Open Mercato rebranded"
  — ต่อยอดสถาปัตยกรรมได้ แต่หน้าตา/ภาษา/บุคลิกต้องเป็นของ Orva เอง

## Brand personality

Modern + Reliable + Technical + Open + Intelligent

**ห้าม**ออกมาเป็น: Traditional ERP / Enterprise consulting / Accounting
software / Government system

## Logo

โลโก้ปัจจุบัน (public/orva.svg) **ผ่าน — ไม่ต้องเปลี่ยน mark**:
ตัว O วงแหวนเปิดช่องบนขวา + จุด node ในช่อง บนพื้น gradient เขียว

ความหมาย: O = Orva/Organization/OS · ช่องเปิด = openness/extensibility ·
node = module/connection/intelligence

### Logo system (4 ระดับ)

| ระดับ | ใช้กับ |
|---|---|
| **App icon** — O + node บนพื้น gradient | favicon, mobile/desktop app, tenant icon |
| **Wordmark** — `ORVA` ตัวอักษรเรียบ ไม่ใส่ effect | หัวเอกสาร |
| **Horizontal** — icon + `ORVA` | เว็บไซต์, เอกสาร, พรีเซนเทชัน |
| **Monochrome** — ขาวล้วน/ดำล้วน | print, เอกสารทางการ |

## Color system

เขียวคือ brand color หลัก — ไม่เปลี่ยน

| Token | ค่า | ใช้กับ |
|---|---|---|
| **Orva Green** (primary) | `#11836E` | primary button, link, active state, icon, brand element |
| **Orva Forest** (dark) | `#0A4A3E` | navbar, hero, dark mode, footer, พื้นแบรนด์เข้ม |
| **Orva Mint** (accent) | `#7EE0C4` | node, highlight, **AI**, automation, active indicator, data viz |

Neutral scale (ให้จอข้อมูลแน่นๆ อ่านง่าย):

```
#FFFFFF  #F8FAF9  #F1F5F3  #DDE7E3  #9AA9A4  #52615D  #26332F  #111816
```

หมายเหตุการใช้งานปัจจุบัน: หน้า marketing ใช้ `BRAND` ใน
`src/app/_marketing/chrome.tsx` — deep `#0A3D33` เป็นเฉดพื้นหลังที่เข้มกว่า
Forest หนึ่งขั้น ใช้คู่กันได้ (gradient deep→forest→green)

## The mint node — CI language ทั้งระบบ

จุด node สี mint ไม่ใช่ decoration — เป็นภาษาภาพของ Orva:

- **AI**: จุด mint นำหน้า = ตัวบ่งชี้ AI (`● Orva AI`)
- **Module map**: โมดูลเป็น node เชื่อมเข้าแกนกลาง
- **Automation**: node คือจุดที่ระบบทำงานให้อัตโนมัติ (trigger → ● → action)
- **Integration**: การเชื่อมต่อภายนอกวาดเป็นเส้น + node

ทุกครั้งที่ต้องวาด diagram, empty state, loading, หรือ indicator ใหม่ —
ถามก่อนว่า "ใช้ node language ได้ไหม"

## Typography

ทิศทาง: modern grotesk / clean sans-serif — **ห้ามฟอนต์กลิ่น corporate ERP**

ข้อจำกัดจริงของ Orva: ระบบเป็นไทยเป็นหลัก **Inter / Geist ไม่มีอักขระไทย**
จึงต้องจับคู่เสมอ:

ตัดสินใจแล้ว (design-language v2, 2026-09-01) — เสียงของ Orva คือคู่ฟอนต์:

| บทบาท | ฟอนต์ | เหตุผล |
|---|---|---|
| **จอ** (UI ทั้งระบบ) | **Anuphan** | loopless ไทยร่วมสมัย เป็นเสียงของแอปเอง ครอบคลุมละตินในตัว |
| **กระดาษ** (เอกสารพิมพ์ทุกใบ) | **Sarabun** | ฟอนต์เอกสารราชการที่นักบัญชีไทยคุ้นและเชื่อถือ |

ทั้งคู่โหลดผ่าน next/font ใน `src/app/layout.tsx`; แผ่นเอกสารรับผ่าน
`--font-document` (ประกาศบน body — ดูคอมเมนต์ใน globals.css)

**ลายเซ็นโครงสร้าง — เส้นคู่บัญชี** (`.orva-ledger-total`): เส้นคู่ปิดยอด
แบบสมุดบัญชีไทย ใช้กับตัวเลขเงินที่เป็นยอดสรุปเท่านั้น ห้ามใช้ตกแต่ง

## กติกาเทียบ Open Mercato

- ไม่ทำหน้าตา/โทนให้เหมือน Open Mercato แม้ใช้สถาปัตยกรรมร่วม
- เครดิต Open Mercato อยู่ที่หน้า `/about` (กล่อง "เทคโนโลยีเบื้องหลัง")
  แบบ low-key — ไม่ใส่บนหน้า landing / footer
