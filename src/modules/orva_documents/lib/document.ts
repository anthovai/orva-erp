/**
 * Presentation model for a printable Thai business document.
 *
 * `buildPrintableDocument` is the single place the Thai rules live: which
 * heading a type carries, which parties must show a taxpayer id, how VAT is
 * presented, and the amount in words. It is pure and IO-free so the rules are
 * unit-tested rather than trusted.
 *
 * The renderer never computes tax. Sales already stored the tax it charged;
 * re-deriving it here would let a document disagree with the ledger.
 */
import { bahtText } from './bahtText'

export const DOCUMENT_TYPES = ['quotation', 'invoice', 'tax_invoice', 'receipt', 'abbreviated_tax_invoice', 'credit_note', 'debit_note', 'billing_note', 'statement', 'payslip', 'purchase_order'] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export const TEMPLATE_IDS = ['classic', 'modern', 'compact', 'brand'] as const

/**
 * Which document types a record kind may print. One bill, two record types:
 * the quotation prints from the quote; every billing document prints from
 * the invoice that was issued as a งวด of it. Sample data may show anything.
 */
export function typesForSourceKind(sourceKind: string | undefined): readonly DocumentType[] {
  if (sourceKind === 'quote') return ['quotation']
  if (sourceKind === 'invoice') return ['invoice', 'tax_invoice', 'receipt', 'abbreviated_tax_invoice', 'billing_note', 'statement']
  if (sourceKind === 'credit_memo') return ['credit_note', 'debit_note']
  if (sourceKind === 'payroll_line') return ['payslip']
  if (sourceKind === 'purchase_order') return ['purchase_order']
  return DOCUMENT_TYPES
}
export type TemplateId = (typeof TEMPLATE_IDS)[number]

/** Thai heading + English subtitle, as printed at the top of the sheet. */
const HEADINGS: Record<DocumentType, { th: string; en: string }> = {
  quotation: { th: 'ใบเสนอราคา', en: 'Quotation' },
  invoice: { th: 'ใบแจ้งหนี้', en: 'Invoice' },
  // The tenant's statutory form combines them: the tax invoice doubles as
  // the invoice when billing VAT work (ORIGINAL TAX INVOICE / INVOICE).
  tax_invoice: { th: 'ใบกำกับภาษี / ใบแจ้งหนี้', en: 'Tax Invoice / Invoice' },
  // Thai practice issues one combined sheet when payment is taken on issue,
  // rather than a bare receipt alongside a separate tax invoice. That is why
  // this type is statutory below: it carries both parties' taxpayer ids.
  receipt: { th: 'ใบกำกับภาษี/ใบเสร็จรับเงิน', en: 'Tax Invoice / Receipt' },
  // Retail (B2C) slip under ป.86/2542 §6: seller identity and number, but the
  // buyer may be anonymous and prices print VAT-inclusive with the statement
  // "ราคารวมภาษีมูลค่าเพิ่มแล้ว". The buyer cannot claim input VAT from it.
  abbreviated_tax_invoice: { th: 'ใบกำกับภาษีอย่างย่อ', en: 'Abbreviated Tax Invoice' },
  // ป.82/2542: a credit/debit note is itself a tax document and must quote the
  // original tax invoice, the correct amount, the difference and the reason.
  credit_note: { th: 'ใบลดหนี้', en: 'Credit Note' },
  debit_note: { th: 'ใบเพิ่มหนี้', en: 'Debit Note' },
  // ใบวางบิล is a collection request, not a tax document: it lists the open
  // invoices of one customer with the payment block.
  billing_note: { th: 'ใบวางบิล', en: 'Billing Note' },
  // ใบแจ้งยอด is a statement of account, not a collection request: it shows
  // everything billed and everything paid up to a date so both sides can
  // agree on the balance. ใบวางบิล above says "pay these"; this says
  // "here is how we got to this number".
  statement: { th: 'ใบแจ้งยอด', en: 'Statement of Account' },
  // Not a tax document: it proves what the employee was paid and what was
  // withheld, and is the paper trail behind ภ.ง.ด.1 and สปส.1-10.
  payslip: { th: 'สลิปเงินเดือน', en: 'Payslip' },
  // The only outgoing document where this company is the buyer: we
  // issue it, the vendor receives it. Not a tax document — no VAT is
  // claimed by ordering something.
  purchase_order: { th: 'ใบสั่งซื้อ', en: 'Purchase Order' },
}

/** Types that are statutory tax documents and must carry the SELLER's taxpayer id. */
const TAX_DOCUMENT_TYPES = new Set<DocumentType>(['tax_invoice', 'receipt', 'abbreviated_tax_invoice', 'credit_note', 'debit_note'])
/** Statutory types that also need the BUYER's taxpayer id (full tax invoices). */
const FULL_TAX_DOCUMENT_TYPES = new Set<DocumentType>(['tax_invoice', 'receipt', 'credit_note', 'debit_note'])

export type Party = {
  name: string
  /** Registered name — statutory contexts print this over the display name. */
  legalName?: string | null
  taxId?: string | null
  branch?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
}

export type DocumentLine = {
  description: string
  quantity: number
  unitPrice: number
  amount: number
}

export type DocumentSource = {
  number: string
  issueDate: string
  /** Quotation validity, invoice due date, or receipt payment date. */
  secondaryDate?: string | null
  currencyCode: string
  lines: DocumentLine[]
  subtotal: number
  discount?: number
  taxRate?: number | null
  taxAmount: number
  grandTotal: number
  note?: string | null
  paymentMethod?: string | null
  /** Credit/debit note: the original tax invoice and the correction, as ป.82/2542 requires on the sheet. */
  reference?: DocumentReference | null
}

export type DocumentReference = {
  invoiceNumber: string
  invoiceDate: string | null
  /** amount on the original tax invoice (gross) */
  originalAmount: number
  /** what it should have been (gross) */
  correctAmount: number
  /** difference (gross) — the note's grand total */
  difference: number
  reason: string
}

export type PrintableDocument = {
  type: DocumentType
  template: TemplateId
  headingTh: string
  headingEn: string
  number: string
  issueDate: string
  secondaryDateLabelKey: string | null
  secondaryDate: string | null
  seller: Party
  buyer: Party
  lines: DocumentLine[]
  currencyCode: string
  subtotal: number
  discount: number
  taxRate: number | null
  taxAmount: number
  grandTotal: number
  /** Baht text, or null when the document is not in THB. */
  amountInWords: string | null
  note: string | null
  paymentMethod: string | null
  /** การชำระเงิน block from settings (bank account, terms) — every type. */
  paymentDetails: string | null
  /** Header logo as an image data URI (settings), or null. */
  logoHeader: string | null
  /** Footer mark as an image data URI (settings), or null. */
  logoFooter: string | null
  /**
   * Which counterpart this sheet is: ต้นฉบับ (สำหรับลูกค้า) or สำเนา
   * (สำหรับบริษัท). Tax documents print both, Thai practice — the print page
   * renders the copy sheet after the original.
   */
  copyRole: 'original' | 'copy'
  /** Standard terms (หมายเหตุ) from settings — printed on tax documents. */
  terms: string | null
  /** Accent colour for the 'brand' template (tenant-configured). */
  accentColor: string | null
  /** True for statutory documents: templates then print the tax id block. */
  isTaxDocument: boolean
  /**
   * ใบกำกับภาษีอย่างย่อ: buyer identity optional, line prices and amounts are
   * VAT-INCLUSIVE and the sheet states so; `taxAmount` is the VAT contained.
   */
  isAbbreviated: boolean
  /** Payslip: lines are earnings and deductions (deductions negative), grandTotal is net pay. */
  isPayslip: boolean
  /**
   * What to call the two party blocks. Every sales document is issued by the
   * seller to a customer; a ใบสั่งซื้อ is issued by the buyer to a vendor, so
   * the titles travel with the document instead of being fixed in templates.
   */
  partyTitles: PartyTitles
  /** Original-invoice block for credit/debit notes; null elsewhere. */
  reference: DocumentReference | null
  /**
   * Non-empty when the document would be legally deficient — the preview
   * shows these instead of silently rendering an invalid tax invoice.
   */
  warnings: DocumentWarning[]
}

export type DocumentWarning = 'seller_tax_id_missing' | 'buyer_tax_id_missing'

function secondaryDateLabel(type: DocumentType): string | null {
  switch (type) {
    case 'quotation':
      return 'orva_documents.field.validUntil'
    case 'invoice':
      return 'orva_documents.field.dueDate'
    case 'receipt':
      return 'orva_documents.field.paidDate'
    case 'payslip':
      return 'orva_documents.field.payPeriod'
    default:
      return null
  }
}

/**
 * Which side of the sheet each party block is.
 *
 * Every sales document is issued by the seller to a customer, so the two
 * blocks were labelled ผู้ขาย / ลูกค้า in the templates. A ใบสั่งซื้อ reverses
 * that: we issue it and the vendor receives it. The structural fields keep
 * their names — `seller` is always the issuer, `buyer` always the
 * counterparty — and only the printed titles change, so no template has to
 * know which document it is drawing.
 */
export type PartyTitles = {
  issuerKey: string
  issuerTh: string
  counterpartyKey: string
  counterpartyTh: string
}

export function partyTitlesFor(type: DocumentType): PartyTitles {
  if (type === 'purchase_order') {
    return {
      issuerKey: 'orva_documents.field.purchaser',
      issuerTh: 'ผู้ซื้อ',
      counterpartyKey: 'orva_documents.field.supplier',
      counterpartyTh: 'ผู้ขาย',
    }
  }
  return {
    issuerKey: 'orva_documents.field.seller',
    issuerTh: 'ผู้ขาย',
    counterpartyKey: 'orva_documents.field.buyer',
    counterpartyTh: 'ลูกค้า',
  }
}

export function buildPrintableDocument(input: {
  type: DocumentType
  template: TemplateId
  seller: Party
  buyer: Party
  source: DocumentSource
  accentColor?: string | null
  paymentDetails?: string | null
  logoHeader?: string | null
  logoFooter?: string | null
  terms?: string | null
}): PrintableDocument {
  const { type, template, seller, buyer, source } = input
  const heading = HEADINGS[type]
  const isTaxDocument = TAX_DOCUMENT_TYPES.has(type)
  const isAbbreviated = type === 'abbreviated_tax_invoice'
  const isPayslip = type === 'payslip'

  const warnings: DocumentWarning[] = []
  if (isTaxDocument) {
    // A Thai tax invoice without the issuer's taxpayer id cannot be used by
    // the buyer to claim input VAT — surfacing this beats printing it.
    if (!seller.taxId || seller.taxId.trim().length === 0) warnings.push('seller_tax_id_missing')
    if (FULL_TAX_DOCUMENT_TYPES.has(type) && (!buyer.taxId || buyer.taxId.trim().length === 0)) warnings.push('buyer_tax_id_missing')
  }

  // Retail slip: re-express every line VAT-inclusive so the printed unit
  // prices match the shelf price; the grand total is unchanged.
  const lines = isAbbreviated && source.taxRate
    ? source.lines.map((line) => ({
        ...line,
        unitPrice: Math.round(line.unitPrice * (1 + source.taxRate! / 100) * 100) / 100,
        amount: Math.round(line.amount * (1 + source.taxRate! / 100) * 100) / 100,
      }))
    : source.lines

  return {
    type,
    template,
    accentColor: input.accentColor ?? null,
    headingTh: heading.th,
    headingEn: heading.en,
    number: source.number,
    issueDate: source.issueDate,
    secondaryDateLabelKey: secondaryDateLabel(type),
    secondaryDate: source.secondaryDate ?? null,
    seller,
    // a retail slip may go to an anonymous walk-in customer
    buyer: isAbbreviated && !buyer.name?.trim() ? { ...buyer, name: 'ลูกค้าทั่วไป' } : buyer,
    lines,
    currencyCode: source.currencyCode,
    subtotal: isAbbreviated ? source.grandTotal : source.subtotal,
    discount: source.discount ?? 0,
    taxRate: source.taxRate ?? null,
    taxAmount: source.taxAmount,
    grandTotal: source.grandTotal,
    // bahtText spells บาท/สตางค์. On a foreign-currency document that would
    // state an amount in words contradicting the figures next to it — a USD
    // total read aloud as baht. Better to print no words than wrong ones.
    amountInWords: source.currencyCode === 'THB' ? bahtText(source.grandTotal) : null,
    note: source.note ?? null,
    paymentMethod: type === 'receipt' ? (source.paymentMethod ?? null) : null,
    paymentDetails: input.paymentDetails ?? null,
    logoHeader: input.logoHeader ?? null,
    logoFooter: input.logoFooter ?? null,
    copyRole: 'original',
    terms: isTaxDocument ? (input.terms ?? null) : null,
    isTaxDocument,
    isAbbreviated,
    isPayslip,
    partyTitles: partyTitlesFor(type),
    reference: source.reference ?? null,
    warnings,
  }
}

/** Sample data so the preview is useful before the tenant has any records. */
export function sampleSource(): DocumentSource {
  const lines: DocumentLine[] = [
    { description: 'ค่าบริการติดตั้งระบบ ERP', quantity: 1, unitPrice: 120000, amount: 120000 },
    { description: 'ค่าอบรมผู้ใช้งาน (ต่อวัน)', quantity: 2, unitPrice: 15000, amount: 30000 },
    { description: 'ค่าบำรุงรักษารายปี', quantity: 1, unitPrice: 36000, amount: 36000 },
  ]
  const subtotal = lines.reduce((sum, line) => sum + line.amount, 0)
  const taxAmount = Math.round(subtotal * 0.07 * 100) / 100
  return {
    number: 'QT-2026-0001',
    issueDate: '2026-08-31',
    secondaryDate: '2026-09-30',
    currencyCode: 'THB',
    lines,
    subtotal,
    discount: 0,
    taxRate: 7,
    taxAmount,
    grandTotal: subtotal + taxAmount,
    note: 'ราคานี้ยังไม่รวมค่าเดินทางนอกเขตกรุงเทพฯ',
    paymentMethod: 'เงินโอน',
  }
}

export function sampleBuyer(): Party {
  return {
    name: 'บริษัท ตัวอย่างลูกค้า จำกัด',
    taxId: '0105561000123',
    branch: 'สำนักงานใหญ่',
    address: '99/9 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพฯ 10110',
    phone: '02-000-0000',
    email: 'account@example.co.th',
  }
}

/**
 * Sample payslip: a payroll-shaped sheet for tenants with no run calculated
 * yet. Sales sample data on a payslip printed "ค่าบริการติดตั้งระบบ ERP" as an
 * employee's earnings, which teaches the operator the wrong thing about the
 * document.
 */
export function samplePayslipSource(): DocumentSource {
  const salary = 45000
  const sso = 750
  const wht = 1200
  return {
    number: 'PRUN-0001-EMP-0001',
    issueDate: '2026-09-30',
    secondaryDate: '2026-09',
    currencyCode: 'THB',
    lines: [
      { description: 'เงินเดือน', quantity: 1, unitPrice: salary, amount: salary },
      { description: 'หัก ประกันสังคม (ลูกจ้าง)', quantity: 1, unitPrice: -sso, amount: -sso },
      { description: 'หัก ภาษีเงินได้ ณ ที่จ่าย', quantity: 1, unitPrice: -wht, amount: -wht },
    ],
    subtotal: salary,
    discount: 0,
    taxRate: null,
    taxAmount: 0,
    grandTotal: salary - sso - wht,
  }
}

/** Sample employee for the payslip preview. */
export function sampleEmployee(): Party {
  return { name: 'ตัวอย่าง พนักงาน', taxId: null, branch: null, address: 'รหัสพนักงาน EMP-0001' }
}
