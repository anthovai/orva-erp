// Orva: machine-translate every upstream module dictionary to Thai.
//
// Strategy: the `orva` app module registers LAST, and dictionary merging is
// flat last-write-wins across modules — so one big th.json in
// src/modules/orva/i18n overrides/extends every core module without patches.
//
// - Collects all @open-mercato/*/src/modules/*/i18n/en.json keys
// - Skips keys already translated (resume-safe; file saved incrementally)
// - Translates in batches via OpenAI (OPENAI_API_KEY / OM_AI_MODEL from .env)
//   with an ERP/accounting glossary
// - Guards: placeholders ({x}, {{x}}, %s, <tags>) must survive translation,
//   otherwise the English original is kept for that key
//
// Usage: node scripts/translate-core-th.mjs [--dry] [--limit N]
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { globSync } from 'glob'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT_FILE = path.join(ROOT, 'src/modules/orva/i18n/th.json')
const API_KEY = process.env.OPENAI_API_KEY
const MODEL = process.env.OM_AI_MODEL || 'gpt-5-mini'
const DRY = process.argv.includes('--dry')
const limitArg = process.argv.indexOf('--limit')
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity
const BATCH = 80
const CONCURRENCY = 4

if (!API_KEY && !DRY) {
  console.error('OPENAI_API_KEY is not set')
  process.exit(1)
}

// Branding keys that must keep OUR values no matter what (reapplied last).
const BRAND_OVERRIDES = {
  'auth.login.brandName': 'Orva',
  'auth.login.logoAlt': 'โลโก้ Orva',
  'appShell.productName': 'Orva',
  'api.docs.title': 'Orva API',
}

const GLOSSARY = `
Customer=ลูกค้า, Vendor/Supplier=ผู้ขาย, Order=คำสั่งขาย, Quote=ใบเสนอราคา,
Invoice=ใบแจ้งหนี้, Credit memo=ใบลดหนี้, Payment=การชำระเงิน, Shipment=การจัดส่ง,
Return=การคืนสินค้า, Product=สินค้า, Category=หมวดหมู่, Warehouse=คลังสินค้า,
Inventory/Stock=สต๊อก, Save=บันทึก, Cancel=ยกเลิก, Delete=ลบ, Edit=แก้ไข,
Create=สร้าง, Search=ค้นหา, Filter=ตัวกรอง, Settings=ตั้งค่า, Dashboard=แดชบอร์ด,
Draft=ฉบับร่าง, Posted=โพสต์แล้ว, Pending=รอดำเนินการ, Completed=เสร็จสิ้น,
Cancelled=ยกเลิกแล้ว, Active=ใช้งาน, Inactive=ไม่ใช้งาน, Role=บทบาท, User=ผู้ใช้,
Permission=สิทธิ์, Organization=องค์กร, Tenant=ผู้เช่าระบบ, Debit=เดบิต,
Credit=เครดิต, Account=บัญชี, Deal=ดีล, Pipeline=ไปป์ไลน์, Activity=กิจกรรม,
Task=งาน, Due date=วันครบกำหนด, Amount=จำนวนเงิน, Total=ยอดรวม, Tax=ภาษี,
Discount=ส่วนลด, Currency=สกุลเงิน, Attachment=ไฟล์แนบ, Notification=การแจ้งเตือน,
Workflow=เวิร์กโฟลว์, Employee=พนักงาน, Leave=การลา, Timesheet=บันทึกเวลา`

const SYSTEM_PROMPT = `You are a professional Thai localizer for a business ERP application (accounting, sales, CRM, warehouse, HR).
Translate each English UI string value to natural, concise Thai suitable for business software.
STRICT RULES:
1. Return ONLY a JSON object with EXACTLY the same keys, values translated to Thai.
2. Preserve ALL placeholders verbatim: {name}, {{count}}, %s, %d, <b>...</b>, markdown, URLs, and code identifiers.
3. Keep product/brand names unchanged: Orva, Open Mercato, Stripe, Akeneo, Gmail, IMAP, S3, Meilisearch, OpenAI, PDF, CSV, API, ID, SKU, URL, OAuth, MCP, webhook (webhook may stay English).
4. Keep technical strings that are not human sentences (pure identifiers, format tokens) unchanged.
5. Use polite neutral Thai without ครับ/ค่ะ. No trailing periods unless the English has meaningful punctuation.
6. Follow this glossary strictly:${GLOSSARY}`

function collectEnglish() {
  const patterns = [
    'node_modules/@open-mercato/*/src/modules/*/i18n/en.json',
  ]
  const files = patterns.flatMap((p) => globSync(p, { cwd: ROOT, absolute: true }))
  const merged = {}
  for (const file of files.sort()) {
    try {
      const json = JSON.parse(fs.readFileSync(file, 'utf8'))
      for (const [k, v] of Object.entries(json)) {
        if (typeof v === 'string' && !(k in merged)) merged[k] = v
      }
    } catch (e) {
      console.warn('skip unparsable', file, e.message)
    }
  }
  return merged
}

function extractTokens(value) {
  const tokens = []
  const patterns = [/\{\{[^}]*\}\}/g, /\{[^}]*\}/g, /%[sd]/g, /<[^>]+>/g]
  for (const re of patterns) for (const m of value.match(re) ?? []) tokens.push(m)
  return tokens
}

function placeholdersOk(en, th) {
  for (const token of extractTokens(en)) {
    if (!th.includes(token)) return false
  }
  return true
}

async function translateBatch(entries, attempt = 0) {
  const payload = Object.fromEntries(entries)
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(payload) },
      ],
    }),
  })
  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 5) throw new Error(`API ${res.status} after retries`)
    const wait = 2000 * 2 ** attempt
    await new Promise((r) => setTimeout(r, wait))
    return translateBatch(entries, attempt + 1)
  }
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const body = await res.json()
  const text = body.choices?.[0]?.message?.content ?? '{}'
  let out
  try {
    out = JSON.parse(text)
  } catch {
    if (attempt >= 3) throw new Error('unparsable model output')
    return translateBatch(entries, attempt + 1)
  }
  const result = {}
  for (const [k, en] of entries) {
    const th = out[k]
    if (typeof th === 'string' && th.trim() && placeholdersOk(en, th)) {
      result[k] = th
    } else {
      result[k] = en // fail-safe: keep English rather than break a placeholder
    }
  }
  return result
}

async function main() {
  const english = collectEnglish()
  const existing = fs.existsSync(OUT_FILE) ? JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')) : {}
  const pending = Object.entries(english).filter(([k]) => !(k in existing)).slice(0, LIMIT)
  console.log(`english keys: ${Object.keys(english).length}, already translated: ${Object.keys(existing).length}, pending: ${pending.length}`)
  if (DRY || pending.length === 0) return

  const batches = []
  for (let i = 0; i < pending.length; i += BATCH) batches.push(pending.slice(i, i + BATCH))

  const translations = { ...existing }
  let done = 0
  let cursor = 0
  const save = () => {
    const finalOut = { ...translations, ...BRAND_OVERRIDES }
    fs.writeFileSync(OUT_FILE, JSON.stringify(finalOut, null, 2) + '\n')
  }
  const worker = async () => {
    while (cursor < batches.length) {
      const idx = cursor++
      const batch = batches[idx]
      try {
        const result = await translateBatch(batch)
        Object.assign(translations, result)
      } catch (e) {
        console.error(`batch ${idx} failed permanently: ${e.message} — keeping English`)
        for (const [k, v] of batch) translations[k] = v
      }
      done++
      if (done % 5 === 0 || done === batches.length) {
        save()
        console.log(`progress: ${done}/${batches.length} batches (${Object.keys(translations).length} keys)`)
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  save()
  console.log(`DONE: ${Object.keys(translations).length + Object.keys(BRAND_OVERRIDES).length} keys in ${OUT_FILE}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
