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

export const DOCUMENT_TYPES = ['quotation', 'invoice', 'tax_invoice', 'receipt'] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export const TEMPLATE_IDS = ['classic', 'modern', 'compact', 'brand'] as const

/**
 * Which document types a record kind may print. One bill, two record types:
 * the quotation prints from the quote; every billing document prints from
 * the invoice that was issued as a งวด of it. Sample data may show anything.
 */
export function typesForSourceKind(sourceKind: string | undefined): readonly DocumentType[] {
  if (sourceKind === 'quote') return ['quotation']
  if (sourceKind === 'invoice') return ['invoice', 'tax_invoice', 'receipt']
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
}

/** Types that are statutory tax documents and must carry taxpayer ids. */
const TAX_DOCUMENT_TYPES = new Set<DocumentType>(['tax_invoice', 'receipt'])

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
    default:
      return null
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

  const warnings: DocumentWarning[] = []
  if (isTaxDocument) {
    // A Thai tax invoice without the issuer's taxpayer id cannot be used by
    // the buyer to claim input VAT — surfacing this beats printing it.
    if (!seller.taxId || seller.taxId.trim().length === 0) warnings.push('seller_tax_id_missing')
    if (!buyer.taxId || buyer.taxId.trim().length === 0) warnings.push('buyer_tax_id_missing')
  }

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
    buyer,
    lines: source.lines,
    currencyCode: source.currencyCode,
    subtotal: source.subtotal,
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
