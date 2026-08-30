// Orva: localize seeded DATA (not UI strings) to Thai.
//
// Two sources render raw English inside an otherwise Thai backoffice:
//   1. `customer_dictionary_entries` — statuses, lifecycle stages, sources,
//      activity/address types, deal statuses. The grid prints `entry.label`
//      (or the raw value when no entry exists), so English labels survive
//      every i18n pass.
//   2. `custom_field_defs.config_json` — `label`, `description`, and select
//      `options`. Options accept `{ value, label }` (see shared
//      modules/entities/options.ts), so values stay stable while labels get
//      translated; filters and stored data are unaffected.
//
// Idempotent: rows already carrying Thai are skipped. Values are NEVER
// touched — only human-facing labels.
//
// Usage: node scripts/localize-seed-data-th.mjs [--dry]
import 'dotenv/config'
import pg from 'pg'

const DRY = process.argv.includes('--dry')
const url = process.env.ORVA_ADMIN_DATABASE_URL || process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL (or ORVA_ADMIN_DATABASE_URL) is not set')
  process.exit(1)
}

const hasThai = (value) => typeof value === 'string' && /[฀-๿]/.test(value)

/** Dictionary + option value translations, keyed by the stored value. */
const VALUE_LABELS = {
  // status
  active: 'ใช้งาน',
  inactive: 'ไม่ใช้งาน',
  archived: 'เก็บถาวร',
  blocked: 'ถูกระงับ',
  // lifecycle stage
  lead: 'ผู้สนใจ',
  prospect: 'ผู้มุ่งหวัง',
  customer: 'ลูกค้า',
  partner: 'พันธมิตร',
  churned: 'ยกเลิกใช้บริการ',
  // source
  website: 'เว็บไซต์',
  referral: 'การแนะนำ',
  customer_referral: 'ลูกค้าแนะนำ',
  partner_referral: 'พันธมิตรแนะนำ',
  event: 'งานอีเวนต์',
  campaign: 'แคมเปญ',
  cold_outreach: 'ติดต่อโดยตรง',
  inbound: 'ลูกค้าติดต่อเข้ามา',
  outbound: 'ทีมขายติดต่อออกไป',
  advertising: 'โฆษณา',
  social_media: 'โซเชียลมีเดีย',
  // activity / interaction type
  call: 'โทรศัพท์',
  email: 'อีเมล',
  meeting: 'ประชุม',
  note: 'บันทึก',
  task: 'งาน',
  // address type
  billing: 'ที่อยู่ใบแจ้งหนี้',
  shipping: 'ที่อยู่จัดส่ง',
  office: 'ที่ทำงาน',
  home: 'ที่อยู่บ้าน',
  work: 'ที่ทำงาน',
  // customer role
  account_manager: 'ผู้ดูแลลูกค้า',
  sales_owner: 'เจ้าของงานขาย',
  service_owner: 'เจ้าของงานบริการ',
  // deal status / stages
  open: 'เปิดอยู่',
  in_progress: 'กำลังดำเนินการ',
  won: 'ปิดการขายได้',
  win: 'ปิดการขายได้',
  lost: 'เสียโอกาส',
  loose: 'เสียโอกาส',
  closed: 'ปิดแล้ว',
  qualification: 'คัดกรอง',
  proposal: 'เสนอราคา',
  negotiation: 'เจรจา',
  // custom-field option values
  healthy: 'แข็งแรงดี',
  monitor: 'ต้องเฝ้าระวัง',
  at_risk: 'เสี่ยง',
  positive: 'เชิงบวก',
  neutral: 'เป็นกลาง',
  negative: 'เชิงลบ',
  low: 'ต่ำ',
  medium: 'ปานกลาง',
  high: 'สูง',
  light: 'เบา',
  standard: 'มาตรฐาน',
  complex: 'ซับซ้อน',
  economic_buyer: 'ผู้มีอำนาจตัดสินใจซื้อ',
  champion: 'ผู้สนับสนุนภายใน',
  technical_evaluator: 'ผู้ประเมินด้านเทคนิค',
  influencer: 'ผู้มีอิทธิพลต่อการตัดสินใจ',
  // interaction status
  planned: 'วางแผนไว้',
  waiting: 'รอดำเนินการ',
  done: 'เสร็จสิ้น',
  canceled: 'ยกเลิกแล้ว',
  cancelled: 'ยกเลิกแล้ว',
  pending: 'รอดำเนินการ',
  // extra lifecycle / source values
  subscriber: 'ผู้ติดตาม',
  other: 'อื่นๆ',
  web_form: 'ฟอร์มบนเว็บไซต์',
  // person-company role
  decision_maker: 'ผู้ตัดสินใจ',
  budget_holder: 'ผู้ถืองบประมาณ',
  primary_contact: 'ผู้ติดต่อหลัก',
  end_user: 'ผู้ใช้งานจริง',
  // pipeline stage
  marketing_qualified_lead: 'ผู้สนใจที่ผ่านการคัดกรองจากการตลาด',
  sales_qualified_lead: 'ผู้สนใจที่ผ่านการคัดกรองจากฝ่ายขาย',
  opportunity: 'โอกาสการขาย',
  offering: 'ยื่นข้อเสนอ',
  negotiations: 'เจรจาต่อรอง',
  stalled: 'ชะงัก',
  // deal temperature
  hot: 'ร้อนแรง',
  warm: 'ปานกลาง',
  cold: 'เย็น',
}

/**
 * Values that stay in their original form on purpose: brand/product names
 * (SaaS, LinkedIn), free-text seeds (job titles), and period codes whose
 * label is already language-neutral (Q1 2026).
 */
const KEEP_AS_IS_KINDS = new Set(['industry', 'job_title', 'renewal_quarter'])
const KEEP_AS_IS_VALUES = new Set(['linkedin', 'facebook', 'typeform'])

/** Custom-field label + description translations, keyed by "<entity>.<key>". */
const FIELD_TEXTS = {
  'customer_company_profile.relationship_health': {
    label: 'สุขภาพความสัมพันธ์',
    description: 'การประเมินสถานะความสัมพันธ์กับลูกค้าโดยรวม',
  },
  'customer_company_profile.renewal_quarter': {
    label: 'ไตรมาสที่ต่ออายุ',
    description: 'ไตรมาสที่คาดว่าจะต่ออายุสัญญา',
  },
  'customer_company_profile.customer_marketing_case': {
    label: 'ใช้เป็นกรณีศึกษาการตลาดได้',
    description: 'ลูกค้าอนุญาตให้นำไปใช้ในสื่อการตลาด',
  },
  'customer_company_profile.executive_notes': {
    label: 'บันทึกสำหรับผู้บริหาร',
    description: 'ข้อมูลที่แลกเปลี่ยนในการประชุมระดับผู้บริหาร',
  },
  'customer_person_profile.buying_role': {
    label: 'บทบาทในการตัดสินใจซื้อ',
    description: 'บทบาทของผู้ติดต่อในคณะผู้ตัดสินใจซื้อ',
  },
  'customer_person_profile.newsletter_opt_in': {
    label: 'สมัครรับข่าวสาร',
    description: 'ระบุว่าผู้ติดต่อยินยอมรับอีเมลการตลาดหรือไม่',
  },
  'customer_person_profile.preferred_pronouns': {
    label: 'คำสรรพนามที่ต้องการ',
    description: 'คำเรียกที่ผู้ติดต่อต้องการให้ใช้',
  },
  'customer_deal.competitive_risk': {
    label: 'ความเสี่ยงจากคู่แข่ง',
    description: 'ระดับความเสี่ยงจากคู่แข่งที่ประเมินไว้',
  },
  'customer_deal.estimated_seats': {
    label: 'จำนวนผู้ใช้/ไลเซนส์โดยประมาณ',
    description: 'จำนวนผู้ใช้ที่คาดการณ์สำหรับดีลนี้',
  },
  'customer_deal.implementation_complexity': {
    label: 'ความซับซ้อนในการติดตั้ง',
    description: 'ระดับความพยายามที่ต้องใช้ในการส่งมอบ',
  },
  'customer_deal.requires_legal_review': {
    label: 'ต้องผ่านการตรวจสอบทางกฎหมาย',
    description: 'ดีลมีเงื่อนไขที่ต้องให้ฝ่ายกฎหมายอนุมัติ',
  },
  'customer_activity.engagement_sentiment': {
    label: 'ความรู้สึกจากการติดต่อ',
    description: 'โทนของการติดต่อครั้งล่าสุด',
  },
  'customer_activity.follow_up_owner': {
    label: 'ผู้รับผิดชอบติดตามงาน',
    description: 'สมาชิกในทีมที่รับผิดชอบการติดตามครั้งถัดไป',
  },
  'customer_activity.shared_with_leadership': {
    label: 'แชร์ให้ผู้บริหารแล้ว',
    description: 'สรุปกิจกรรมถูกแชร์ให้ผู้บริหารแล้ว',
  },
  'customer_interaction.engagement_sentiment': {
    label: 'ความรู้สึกจากการติดต่อ',
    description: 'โทนของการติดต่อครั้งล่าสุด',
  },
  'customer_interaction.follow_up_owner': {
    label: 'ผู้รับผิดชอบติดตามงาน',
    description: 'สมาชิกในทีมที่รับผิดชอบการติดตามครั้งถัดไป',
  },
  'customer_interaction.shared_with_leadership': {
    label: 'แชร์ให้ผู้บริหารแล้ว',
    description: 'สรุปกิจกรรมถูกแชร์ให้ผู้บริหารแล้ว',
  },
}

async function main() {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  let dictUpdated = 0
  let fieldUpdated = 0

  // ── 1. dictionary entries
  const dict = await client.query('select id, kind, value, label from customer_dictionary_entries')
  for (const row of dict.rows) {
    if (hasThai(row.label)) continue
    if (KEEP_AS_IS_KINDS.has(row.kind) || KEEP_AS_IS_VALUES.has(row.value)) continue
    const translated = VALUE_LABELS[row.value]
    if (!translated) {
      console.warn(`no translation for dictionary ${row.kind}:${row.value} — left as "${row.label}"`)
      continue
    }
    if (!DRY) {
      await client.query('update customer_dictionary_entries set label = $1, updated_at = now() where id = $2', [translated, row.id])
    }
    dictUpdated++
  }

  // ── 2. custom field defs (label, description, select option labels)
  const defs = await client.query("select id, entity_id, key, config_json from custom_field_defs where entity_id like 'customers%'")
  for (const row of defs.rows) {
    const config = row.config_json ?? {}
    const shortEntity = String(row.entity_id).split(':').pop()
    const texts = FIELD_TEXTS[`${shortEntity}.${row.key}`]
    let changed = false

    if (texts && !hasThai(config.label)) {
      config.label = texts.label
      changed = true
    }
    if (texts?.description && !hasThai(config.description)) {
      config.description = texts.description
      changed = true
    }
    if (Array.isArray(config.options)) {
      const options = config.options.map((option) => {
        if (typeof option === 'string') {
          const label = VALUE_LABELS[option]
          if (!label) return option
          changed = true
          return { value: option, label }
        }
        if (option && typeof option === 'object' && typeof option.value === 'string' && !hasThai(option.label)) {
          const label = VALUE_LABELS[option.value]
          if (!label) return option
          changed = true
          return { ...option, label }
        }
        return option
      })
      config.options = options
    }

    if (changed && !DRY) {
      await client.query('update custom_field_defs set config_json = $1, updated_at = now() where id = $2', [JSON.stringify(config), row.id])
    }
    if (changed) fieldUpdated++
  }

  await client.end()
  console.log(`${DRY ? '[dry] ' : ''}dictionary entries updated: ${dictUpdated}, custom field defs updated: ${fieldUpdated}`)
}

main().catch((error) => { console.error(error); process.exit(1) })
