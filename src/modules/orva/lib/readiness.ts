/**
 * ความพร้อมใช้งาน — is this tenant actually able to do business today?
 *
 * Every check here exists because something was silently wrong on the real
 * tenant and nobody found out until it mattered: the default tax class was
 * Poland's 23% because that is what the upstream seed ships, so a line added
 * without picking a class would have carried the wrong VAT onto a customer's
 * invoice. The hourly rate was never set, so the project screen's cost and
 * margin columns were blank and looked broken. Portal accounts existed with
 * no customer attached, so the customer saw "your account is not connected"
 * and assumed the portal was broken.
 *
 * None of these is a bug in the code. They are the gap between "the software
 * is built" and "the business can use it", which is exactly the gap an
 * operator cannot see from any screen — each fact lives on a different one.
 *
 * The rules are pure so they can be read and tested without a database; the
 * route gathers the facts and calls `assessReadiness`.
 */

export type ReadinessSeverity = 'blocker' | 'warning' | 'ok'

export type ReadinessCheck = {
  id: string
  /** i18n key for the short label, with a Thai fallback at the call site. */
  labelKey: string
  severity: ReadinessSeverity
  /** What is true right now — a value, a count, or an empty string. */
  detail: string
  /** Where the operator goes to fix it; null when it is an env/ops matter. */
  href: string | null
}

export type ReadinessFacts = {
  /** Outbound email is configured (provider key + from address). */
  emailConfigured: boolean
  /** A PDF renderer is resolvable on this host. */
  pdfConfigured: boolean
  seller: { legalName: boolean; taxId: boolean; address: boolean; paymentDetails: boolean }
  /** The rate a line gets when nobody picks one; null when no default exists. */
  defaultTaxRate: number | null
  /** Accounting periods currently open for posting. */
  openPeriods: number
  /** Company hourly rate for project cost/margin. */
  hourlyRate: number | null
  /** Portal users, and how many are attached to a customer record. */
  portalUsers: { total: number; linked: number }
  /** Registered background schedules, and how many are switched on. */
  schedules: { total: number; active: number }
  /** Issued invoices with no journal behind them. */
  unpostedInvoices: number
}

/** Thailand's VAT rate: the one a Thai tenant's lines must default to. */
export const THAI_VAT_RATE = 7

const ok = (id: string, labelKey: string, detail: string, href: string | null = null): ReadinessCheck =>
  ({ id, labelKey, severity: 'ok', detail, href })

/**
 * Turns the facts into a list an operator can act on, worst first.
 *
 * `blocker` means the business cannot do a normal day's work — it cannot bill,
 * post, or send. `warning` means something will be wrong or blank later, and
 * the operator would rather know now than discover it in front of a customer.
 */
export function assessReadiness(facts: ReadinessFacts): ReadinessCheck[] {
  const checks: ReadinessCheck[] = []

  checks.push(facts.emailConfigured
    ? ok('email', 'orva.readiness.email', 'ตั้งค่าแล้ว')
    : { id: 'email', labelKey: 'orva.readiness.email', severity: 'blocker', detail: 'ยังส่งใบเสนอราคา/ใบแจ้งหนี้ทางอีเมลไม่ได้', href: null })

  checks.push(facts.pdfConfigured
    ? ok('pdf', 'orva.readiness.pdf', 'ตั้งค่าแล้ว')
    : { id: 'pdf', labelKey: 'orva.readiness.pdf', severity: 'warning', detail: 'ดาวน์โหลด PDF จะไม่ทำงานบนเครื่องจริง', href: null })

  const missingSeller = ([
    [facts.seller.legalName, 'ชื่อนิติบุคคล'],
    [facts.seller.taxId, 'เลขประจำตัวผู้เสียภาษี'],
    [facts.seller.address, 'ที่อยู่'],
    [facts.seller.paymentDetails, 'ข้อมูลการชำระเงิน'],
  ] as Array<[boolean, string]>).filter(([present]) => !present).map(([, label]) => label)
  checks.push(missingSeller.length === 0
    ? ok('seller', 'orva.readiness.seller', 'ครบ', '/backend/settings/documents')
    : {
        id: 'seller', labelKey: 'orva.readiness.seller',
        // The tax id is required on a ใบกำกับภาษี by law; the rest only make
        // the paper look unfinished.
        severity: facts.seller.taxId ? 'warning' : 'blocker',
        detail: `ยังไม่ได้ตั้ง: ${missingSeller.join(' · ')}`,
        href: '/backend/settings/documents',
      })

  checks.push(facts.defaultTaxRate === THAI_VAT_RATE
    ? ok('tax', 'orva.readiness.tax', `${THAI_VAT_RATE}%`, '/backend/config/sales')
    : {
        id: 'tax', labelKey: 'orva.readiness.tax', severity: 'blocker',
        detail: facts.defaultTaxRate === null
          ? 'ไม่มีคลาสภาษีเริ่มต้น — บรรทัดที่ไม่ได้เลือกภาษีจะไม่มี VAT'
          : `ค่าเริ่มต้นเป็น ${facts.defaultTaxRate}% ไม่ใช่ ${THAI_VAT_RATE}% ของไทย`,
        href: '/backend/config/sales',
      })

  checks.push(facts.openPeriods > 0
    ? ok('period', 'orva.readiness.period', `เปิดอยู่ ${facts.openPeriods} งวด`, '/backend/gl/periods')
    : { id: 'period', labelKey: 'orva.readiness.period', severity: 'blocker', detail: 'ไม่มีงวดบัญชีเปิด — ลงบัญชีไม่ได้', href: '/backend/gl/periods' })

  checks.push(facts.hourlyRate !== null && facts.hourlyRate > 0
    ? ok('rate', 'orva.readiness.rate', String(facts.hourlyRate), '/backend/settings/documents')
    : { id: 'rate', labelKey: 'orva.readiness.rate', severity: 'warning', detail: 'ยังไม่ได้ตั้ง — ต้นทุนและกำไรของโปรเจกต์จะว่าง', href: '/backend/settings/documents' })

  const unlinked = facts.portalUsers.total - facts.portalUsers.linked
  checks.push(unlinked === 0
    ? ok('portal', 'orva.readiness.portal', facts.portalUsers.total ? `ผูกครบ ${facts.portalUsers.total} บัญชี` : 'ยังไม่มีบัญชีพอร์ทัล', '/backend/customer_accounts/users')
    : { id: 'portal', labelKey: 'orva.readiness.portal', severity: 'warning', detail: `${unlinked} บัญชียังไม่ผูกลูกค้า — ลูกค้าจะเห็นว่าบัญชียังไม่เชื่อม`, href: '/backend/customer_accounts/users' })

  checks.push(facts.schedules.active > 0
    ? ok('schedules', 'orva.readiness.schedules', `ทำงาน ${facts.schedules.active}/${facts.schedules.total} รายการ`, '/backend/config/scheduled-jobs')
    : { id: 'schedules', labelKey: 'orva.readiness.schedules', severity: 'warning', detail: 'ไม่มีงานตามตารางที่เปิดอยู่ — การแจ้งเตือนรายวันจะเงียบ', href: '/backend/config/scheduled-jobs' })

  checks.push(facts.unpostedInvoices === 0
    ? ok('posting', 'orva.readiness.posting', 'ลงบัญชีครบ', '/backend/ar/posting')
    : { id: 'posting', labelKey: 'orva.readiness.posting', severity: 'warning', detail: `${facts.unpostedInvoices} ใบยังไม่ลงบัญชี`, href: '/backend/ar/posting' })

  const rank: Record<ReadinessSeverity, number> = { blocker: 0, warning: 1, ok: 2 }
  return checks.sort((a, b) => rank[a.severity] - rank[b.severity])
}

/** How the panel titles itself: the worst thing still outstanding. */
export function readinessSummary(checks: ReadinessCheck[]): { blockers: number; warnings: number; ready: boolean } {
  const blockers = checks.filter((c) => c.severity === 'blocker').length
  const warnings = checks.filter((c) => c.severity === 'warning').length
  return { blockers, warnings, ready: blockers === 0 && warnings === 0 }
}
