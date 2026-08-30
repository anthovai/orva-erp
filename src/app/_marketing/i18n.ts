// Marketing-site dictionary (landing + about). Independent from the app's
// module dictionaries: these pages render before login, and the copy is
// written per locale rather than machine-translated. The locale comes from
// the same `locale` cookie the app uses, so switching here carries into the
// backoffice after login.

export type MarketingLocale = 'th' | 'en'

export function resolveMarketingLocale(cookieValue: string | undefined): MarketingLocale {
  return cookieValue === 'en' ? 'en' : 'th'
}

const th = {
  nav: {
    modules: 'โมดูล',
    screens: 'ภาพระบบ',
    architecture: 'สถาปัตยกรรม',
    about: 'เกี่ยวกับ',
    admin: 'หน้าจัดการ',
    login: 'เข้าสู่ระบบ',
  },
  hero: {
    badge: 'Orva ERP · โดย Anthovai',
    title: 'ERP ครบวงจรสำหรับธุรกิจไทย',
    subtitle: 'ความถูกต้องทางบัญชี ถูกบังคับถึงระดับฐานข้อมูล',
    body:
      'การเงินและบัญชี งานขาย คลังสินค้า และเงินเดือน เชื่อมถึงกันในระบบเดียว ทุกเอกสารไหลเข้าบัญชีแยกประเภทอัตโนมัติ ปิดงวดได้จริง ตรวจสอบย้อนหลังได้ทุกรายการ',
    ctaStart: 'เริ่มใช้งาน',
    ctaScreens: 'ดูภาพระบบ',
    trust: [
      'บัญชีคู่บังคับที่ระดับฐานข้อมูล',
      'เอกสารที่โพสต์แล้วแก้ไขไม่ได้',
      'แยกข้อมูลด้วย PostgreSQL RLS',
      'รองรับภาษาไทยทั้งระบบ',
    ],
    financeAlt: 'หน้างบการเงินของ Orva',
    payrollAlt: 'หน้าเงินเดือนของ Orva',
  },
  stats: [
    { value: '6', label: 'กลุ่มงานหลักในระบบเดียว' },
    { value: '4', label: 'รายงานการเงิน real-time' },
    { value: '17,000+', label: 'ข้อความ UI ภาษาไทย' },
    { value: '30+', label: 'กฎบัญชีที่ฐานข้อมูลบังคับ' },
  ],
  modules: {
    kicker: 'โมดูล',
    title: 'ครบทุกงานหลักขององค์กร',
    subtitle: 'การเงินคือแกนกลาง — ทุกโมดูลส่งข้อมูลเข้าบัญชีแยกประเภทเดียวกัน',
    financeTitle: 'การเงินและบัญชี',
    financeBadge: 'แกนกลางของระบบ',
    financeItems: [
      { title: 'บัญชีแยกประเภท (GL)', body: 'ผังบัญชี งวดบัญชี journal บัญชีคู่ และปิดงวดเข้ากำไรสะสมอัตโนมัติ' },
      { title: 'เจ้าหนี้ (AP)', body: 'บิลผู้ขาย → โพสต์ → จ่ายชำระตัดยอดรายบิล กันจ่ายเกินและแก้ย้อนหลัง' },
      { title: 'ลูกหนี้ (AR)', body: 'ดึง invoice จากงานขายเข้าบัญชี แยกภาษีขาย และรับชำระตัดยอดรายใบ' },
      { title: 'รายงานการเงิน', body: 'งบทดลอง งบกำไรขาดทุน งบแสดงฐานะการเงิน และอายุหนี้ AP/AR' },
    ],
    suites: [
      {
        title: 'งานขายและปฏิบัติการ',
        items: ['CRM ลูกค้า · ดีล · ไปป์ไลน์', 'ใบเสนอราคา · คำสั่งขาย · ใบแจ้งหนี้', 'แคตตาล็อกสินค้าและราคา', 'คลังสินค้า (WMS) ครบวงจร'],
      },
      {
        title: 'บุคลากรและเงินเดือน',
        items: ['ทะเบียนพนักงานบน Party กลาง', 'Payroll คำนวณด้วย Rust engine', 'ประกันสังคม + ภาษีขั้นบันได', 'โพสต์เงินเดือนเข้าบัญชีอัตโนมัติ'],
      },
      {
        title: 'แพลตฟอร์มและ AI',
        items: ['AI Assistant ในระบบ (Ctrl+L)', 'สิทธิ์ละเอียดระดับฟีเจอร์ (RBAC)', 'Custom fields ทุก entity', 'ภาษาไทยเต็มระบบ + OpenAPI'],
      },
    ],
  },
  screens: {
    kicker: 'ภาพระบบ',
    title: 'เห็นตัวเลขจริง ก่อนตัดสินใจ',
    cap1Title: 'งบการเงิน real-time',
    cap1Body: 'งบกำไรขาดทุนและงบแสดงฐานะการเงิน คำนวณสดจาก journal ที่โพสต์แล้ว สมการบัญชีลงตัวเสมอ',
    cap2Title: 'เงินเดือนโปร่งใสรายคน',
    cap2Body: 'คำนวณด้วย Rust engine (ประกันสังคม + ภาษีหัก ณ ที่จ่ายขั้นบันได) แล้วโพสต์เข้าบัญชีเป็น journal ที่ดุลเสมอ',
  },
  architecture: {
    kicker: 'สถาปัตยกรรม',
    title: 'สร้างมาเพื่อความน่าเชื่อถือระดับงานบัญชี',
    points: [
      {
        title: 'ความถูกต้องที่พิสูจน์ได้',
        body: 'ทุก journal ต้องดุลก่อนโพสต์ งวดที่ปิดรับรายการใหม่ไม่ได้ และเอกสารที่โพสต์แล้วถูกล็อกด้วย database trigger — ต่อให้เขียน SQL ตรงก็แก้ไม่ได้',
      },
      {
        title: 'ปลอดภัยระดับฐานข้อมูล',
        body: 'ข้อมูลแยกต่อองค์กรด้วย Row-Level Security ของ PostgreSQL เป็นชั้นป้องกันใต้แอปพลิเคชัน พร้อม audit log ก่อน/หลังทุกการแก้ไข',
      },
      {
        title: 'สถาปัตยกรรมที่ขยายได้',
        body: 'โมดูลาร์ทั้งระบบ เพิ่มโมดูลและฟิลด์ได้โดยไม่แก้แกนกลาง งานคำนวณหนักแยกเป็น service ภาษา Rust ที่ผ่าน unit test',
      },
    ],
    techLine: 'PostgreSQL · Next.js / TypeScript · Rust',
  },
  cta: {
    title: 'พร้อมเริ่มใช้ Orva แล้วหรือยัง',
    body: 'จัดการบัญชี งานขาย คลังสินค้า และเงินเดือนของคุณจากที่เดียว — เป็นภาษาไทยทั้งระบบ',
    button: 'เข้าสู่ระบบ',
  },
  footer: {
    tagline: 'ระบบ ERP ครบวงจรสำหรับธุรกิจไทย ที่ความถูกต้องทางบัญชีถูกบังคับถึงระดับฐานข้อมูล',
    product: 'ผลิตภัณฑ์',
    getStarted: 'เริ่มใช้งาน',
    company: 'บริษัท',
    allModules: 'โมดูลทั้งหมด',
    screens: 'ภาพระบบ',
    architecture: 'สถาปัตยกรรม',
    about: 'เกี่ยวกับ Orva',
    login: 'เข้าสู่ระบบ',
    admin: 'หน้าจัดการ',
    api: 'API (OpenAPI)',
    copyright: '© 2026 Anthovai · Orva ERP',
  },
  about: {
    kicker: 'เกี่ยวกับ',
    title: 'ทำไมเราถึงสร้าง Orva',
    lead:
      'ธุรกิจไทยจำนวนมากยังบริหารด้วยสเปรดชีตหลายไฟล์ที่ไม่คุยกัน ตัวเลขปิดงวดกับตัวเลขหน้างานไม่ตรงกัน และซอฟต์แวร์ ERP ที่มีก็มักแพง ซับซ้อน หรือไม่เข้าใจบริบทไทย — Orva เกิดขึ้นเพื่อแก้ปัญหานี้',
    missionTitle: 'สิ่งที่เราเชื่อ',
    missionBody:
      'ระบบบัญชีที่ดีต้อง "ผิดไม่ได้ตั้งแต่ชั้นล่างสุด" — Orva จึงบังคับกฎบัญชีที่ตัวฐานข้อมูลโดยตรง: journal ที่ไม่ดุลจะโพสต์ไม่ได้ เอกสารที่โพสต์แล้วแก้ไขไม่ได้ และงวดที่ปิดแล้วรับรายการใหม่ไม่ได้ ไม่ว่าใครจะเขียนโค้ดหรือคำสั่งอะไรมาก็ตาม',
    whatTitle: 'Orva ทำอะไรได้',
    whatItems: [
      { title: 'การเงินและบัญชีครบวงจร', body: 'ผังบัญชี บัญชีแยกประเภท เจ้าหนี้ ลูกหนี้ งบการเงิน 4 รายงาน และการปิดงวดจริงเข้ากำไรสะสม' },
      { title: 'งานขายถึงคลังสินค้า', body: 'CRM ใบเสนอราคา คำสั่งขาย ใบแจ้งหนี้ แคตตาล็อกสินค้า และคลังสินค้า เชื่อมเข้าบัญชีอัตโนมัติ' },
      { title: 'บุคลากรและเงินเดือนแบบไทย', body: 'ประกันสังคมและภาษีหัก ณ ที่จ่ายแบบขั้นบันไดตามกฎหมายไทย คำนวณโดย engine ภาษา Rust ที่ผ่านการทดสอบ' },
      { title: 'AI ผู้ช่วยในระบบ', body: 'ถามยอดค้างชำระ งบกำไรขาดทุน หรือสรุปเงินเดือนเป็นภาษาไทยได้ทันที โดยเห็นเฉพาะข้อมูลขององค์กรคุณ' },
    ],
    principlesTitle: 'หลักการออกแบบ',
    principles: [
      { title: 'ไทยเป็นภาษาหลัก ไม่ใช่ภาษาแปล', body: 'อินเทอร์เฟซกว่า 17,000 ข้อความเป็นภาษาไทย พร้อมศัพท์บัญชีที่นักบัญชีไทยใช้จริง' },
      { title: 'ข้อมูลของคุณคือของคุณ', body: 'ข้อมูลแต่ละองค์กรถูกแยกด้วย Row-Level Security ที่ตัวฐานข้อมูล PostgreSQL — ไม่ใช่แค่ที่ชั้นแอป' },
      { title: 'ตรวจสอบย้อนหลังได้เสมอ', body: 'ทุกการแก้ไขมี audit log ทุกเอกสารบัญชีอ้างอิงกลับถึงต้นทางได้ และเลขที่เอกสารไม่ซ้ำไม่ข้าม' },
    ],
    companyTitle: 'ผู้พัฒนา',
    companyBody:
      'Orva พัฒนาโดย Anthovai ทีมซอฟต์แวร์ที่เชื่อว่าธุรกิจไทยควรเข้าถึงระบบระดับองค์กรได้โดยไม่ต้องจ่ายราคาระดับองค์กรข้ามชาติ',
    techTitle: 'เทคโนโลยีเบื้องหลัง',
    techBody:
      'Orva ทำงานบน PostgreSQL, Next.js/TypeScript และแยกงานคำนวณหนักเป็น service ภาษา Rust โดยต่อยอดจากแพลตฟอร์มโอเพนซอร์ส Open Mercato (สัญญาอนุญาต MIT) ซึ่งเราร่วมรายงานและแก้ไขปัญหากลับให้ชุมชนด้วย ส่วนโมดูลการเงิน บัญชี และเงินเดือนทั้งหมดคือผลงานที่ Anthovai ออกแบบและพัฒนาขึ้นเอง',
    ctaTitle: 'อยากเห็นของจริงมากกว่านี้?',
    ctaBody: 'ดูภาพหน้าจอจริงของระบบ หรือเข้าสู่ระบบเพื่อลองใช้งาน',
    ctaScreens: 'ดูภาพระบบ',
    ctaLogin: 'เข้าสู่ระบบ',
  },
}

const en: typeof th = {
  nav: {
    modules: 'Modules',
    screens: 'Screenshots',
    architecture: 'Architecture',
    about: 'About',
    admin: 'Admin',
    login: 'Sign in',
  },
  hero: {
    badge: 'Orva ERP · by Anthovai',
    title: 'The complete ERP for Thai business',
    subtitle: 'Accounting correctness, enforced down to the database',
    body:
      'Finance, sales, warehousing and payroll connected in one system. Every document flows into the general ledger automatically — real period closing, full audit trail.',
    ctaStart: 'Get started',
    ctaScreens: 'See the product',
    trust: [
      'Double-entry enforced at the database',
      'Posted documents are immutable',
      'Tenant isolation with PostgreSQL RLS',
      'Fully localized in Thai',
    ],
    financeAlt: 'Orva financial statements screen',
    payrollAlt: 'Orva payroll screen',
  },
  stats: [
    { value: '6', label: 'business areas in one system' },
    { value: '4', label: 'real-time financial reports' },
    { value: '17,000+', label: 'Thai UI strings' },
    { value: '30+', label: 'accounting rules enforced by the DB' },
  ],
  modules: {
    kicker: 'Modules',
    title: 'Every core function of your company',
    subtitle: 'Finance is the core — every module feeds the same general ledger.',
    financeTitle: 'Finance & Accounting',
    financeBadge: 'Core of the system',
    financeItems: [
      { title: 'General Ledger (GL)', body: 'Chart of accounts, fiscal periods, double-entry journals, and automatic closing into retained earnings.' },
      { title: 'Payables (AP)', body: 'Vendor bills → post → pay with per-bill settlement. Overpayment and retro-editing blocked.' },
      { title: 'Receivables (AR)', body: 'Pull sales invoices into the ledger, split output tax, and settle receipts per invoice.' },
      { title: 'Financial reports', body: 'Trial balance, P&L, balance sheet, and AP/AR aging.' },
    ],
    suites: [
      {
        title: 'Sales & Operations',
        items: ['Customer CRM · deals · pipelines', 'Quotes · sales orders · invoices', 'Product catalog and pricing', 'Full warehouse management (WMS)'],
      },
      {
        title: 'People & Payroll',
        items: ['Employee registry on a central Party', 'Payroll computed by a Rust engine', 'Social security + progressive tax', 'Payroll posted to the ledger automatically'],
      },
      {
        title: 'Platform & AI',
        items: ['In-app AI assistant (Ctrl+L)', 'Fine-grained feature RBAC', 'Custom fields on every entity', 'Full Thai localization + OpenAPI'],
      },
    ],
  },
  screens: {
    kicker: 'Screenshots',
    title: 'See real numbers before you decide',
    cap1Title: 'Real-time financial statements',
    cap1Body: 'P&L and balance sheet computed live from posted journals — the accounting equation always balances.',
    cap2Title: 'Transparent per-employee payroll',
    cap2Body: 'Computed by a Rust engine (social security + progressive withholding tax) and posted to the ledger as an always-balanced journal.',
  },
  architecture: {
    kicker: 'Architecture',
    title: 'Built for accounting-grade reliability',
    points: [
      {
        title: 'Provable correctness',
        body: 'Every journal must balance before posting, closed periods reject new entries, and posted documents are locked by database triggers — even raw SQL cannot change them.',
      },
      {
        title: 'Database-level security',
        body: 'Per-organization data isolation with PostgreSQL Row-Level Security as a layer beneath the application, plus before/after audit logs on every change.',
      },
      {
        title: 'An architecture that grows',
        body: 'Modular throughout — add modules and fields without touching the core. Heavy computation runs in unit-tested Rust services.',
      },
    ],
    techLine: 'PostgreSQL · Next.js / TypeScript · Rust',
  },
  cta: {
    title: 'Ready to run on Orva?',
    body: 'Manage accounting, sales, warehousing and payroll from one place — fully in Thai.',
    button: 'Sign in',
  },
  footer: {
    tagline: 'The complete ERP for Thai business, with accounting correctness enforced down to the database.',
    product: 'Product',
    getStarted: 'Get started',
    company: 'Company',
    allModules: 'All modules',
    screens: 'Screenshots',
    architecture: 'Architecture',
    about: 'About Orva',
    login: 'Sign in',
    admin: 'Admin',
    api: 'API (OpenAPI)',
    copyright: '© 2026 Anthovai · Orva ERP',
  },
  about: {
    kicker: 'About',
    title: 'Why we built Orva',
    lead:
      'Many Thai businesses still run on disconnected spreadsheets: closing numbers never match operational numbers, and existing ERPs are expensive, complex, or blind to the Thai context. Orva exists to fix that.',
    missionTitle: 'What we believe',
    missionBody:
      'A good accounting system must be impossible to get wrong at the lowest layer. Orva enforces its accounting rules in the database itself: unbalanced journals cannot post, posted documents cannot change, and closed periods reject new entries — regardless of what code or query tries.',
    whatTitle: 'What Orva does',
    whatItems: [
      { title: 'Complete finance & accounting', body: 'Chart of accounts, general ledger, payables, receivables, four financial reports, and true period closing into retained earnings.' },
      { title: 'Sales through warehouse', body: 'CRM, quotes, sales orders, invoices, product catalog and warehousing — all feeding the ledger automatically.' },
      { title: 'Thai-native people & payroll', body: 'Social security and progressive withholding tax per Thai law, computed by a tested Rust engine.' },
      { title: 'An AI assistant inside', body: 'Ask for outstanding balances, P&L, or payroll summaries in Thai — it only sees your organization’s data.' },
    ],
    principlesTitle: 'Design principles',
    principles: [
      { title: 'Thai first, not translated-to', body: 'Over 17,000 interface strings in Thai, using the accounting vocabulary Thai accountants actually use.' },
      { title: 'Your data is yours', body: 'Each organization’s data is isolated with PostgreSQL Row-Level Security — at the database, not just the app layer.' },
      { title: 'Always auditable', body: 'Every change is audit-logged, every accounting document traces back to its source, and document numbers never skip or repeat.' },
    ],
    companyTitle: 'The team',
    companyBody:
      'Orva is built by Anthovai — a software team that believes Thai businesses deserve enterprise-grade systems without multinational enterprise pricing.',
    techTitle: 'Under the hood',
    techBody:
      'Orva runs on PostgreSQL and Next.js/TypeScript, with heavy computation in Rust services. It builds on the open-source Open Mercato platform (MIT license), to which we report and contribute fixes — while the finance, accounting, and payroll modules are designed and built by Anthovai.',
    ctaTitle: 'Want to see more?',
    ctaBody: 'Browse real product screenshots, or sign in and try it.',
    ctaScreens: 'See the product',
    ctaLogin: 'Sign in',
  },
}

export const marketingDict: Record<MarketingLocale, typeof th> = { th, en }
export type MarketingDict = typeof th
