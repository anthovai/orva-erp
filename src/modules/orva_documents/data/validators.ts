import { z } from 'zod'
import { DOCUMENT_TYPES, TEMPLATE_IDS } from '../lib/document'

const templateSchema = z.enum(TEMPLATE_IDS)

/** Thai taxpayer ids are exactly 13 digits; blank means "not set yet". */
const taxIdSchema = z
  .string()
  .trim()
  .max(20)
  .refine((value) => value.length === 0 || /^\d{13}$/.test(value.replace(/[\s-]/g, '')), {
    message: 'orva_documents.errors.taxId',
  })
  .optional()
  .nullable()

/**
 * A logo travels as an image data URI so the printed sheet is self-contained
 * (headless Chromium needs no authenticated fetch). ~400 KB keeps the
 * settings row and every preview payload reasonable.
 */
const logoSchema = z
  .string()
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)
  .max(400_000)
  .optional()
  .nullable()
  .or(z.literal('').transform(() => null))

export const settingsPutSchema = z.object({
  sellerName: z.string().trim().min(1),
  sellerLegalName: z.string().trim().max(300).optional().nullable(),
  sellerTaxId: taxIdSchema,
  sellerBranch: z.string().trim().max(60).optional().nullable(),
  sellerAddress: z.string().trim().max(500).optional().nullable(),
  sellerPhone: z.string().trim().max(60).optional().nullable(),
  sellerEmail: z.string().trim().max(200).optional().nullable(),
  templateQuotation: templateSchema.optional(),
  templateInvoice: templateSchema.optional(),
  templateTaxInvoice: templateSchema.optional(),
  templateReceipt: templateSchema.optional(),
  invoiceNumberFormat: z.string().trim().min(1).max(120).optional(),
  brandColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  paymentDetails: z.string().trim().max(1000).optional().nullable(),
  logoHeader: logoSchema,
  logoFooter: logoSchema,
  logoHeaderQuotation: logoSchema,
  documentTerms: z.string().trim().max(2000).optional().nullable(),
  etaxSenderEmail: z.string().trim().email().optional().nullable().or(z.literal('').transform(() => null)),
})

export const previewQuerySchema = z.object({
  type: z.enum(DOCUMENT_TYPES),
  template: templateSchema.optional(),
  /** Sales document to render; sample data is used when absent. */
  documentId: z.string().uuid().optional(),
  /**
   * Preview the sheet as a given brand. A real document takes its brand from
   * its own number, so this only applies to sample data and to numbers that
   * carry no brand prefix — it exists so a new brand can be checked before
   * its first document is issued.
   */
  brand: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,6}$/).optional(),
  /**
   * ใบแจ้งยอด only: the date the account is stated as at. Invoices issued
   * after it, and payments received after it, belong to the next statement.
   * Absent means the whole account to date.
   */
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

/**
 * Issuing a real invoice record from a quote. Either a fixed amount or a
 * percentage of the quote's pre-VAT subtotal; the line always carries 7% VAT
 * like the quote lines it derives from.
 */
export const issueInvoiceSchema = z
  .object({
    quoteId: z.string().uuid(),
    amount: z.coerce.number().positive().optional(),
    percent: z.coerce.number().positive().max(100).optional(),
    description: z.string().trim().max(500).optional(),
    dueInDays: z.coerce.number().int().min(0).max(365).optional(),
  })
  .refine((value) => (value.amount != null) !== (value.percent != null), {
    message: 'Provide exactly one of amount or percent',
  })

/**
 * Recording a payment against an issued invoice. Thai service practice: the
 * buyer withholds 3% of the pre-VAT amount (ภาษีหัก ณ ที่จ่าย) and remits it
 * to the Revenue Department, so cash received + WHT together settle the bill.
 */
export const recordPaymentSchema = z.object({
  invoiceId: z.string().uuid(),
  /** YYYY-MM-DD */
  paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountReceived: z.coerce.number().positive(),
  whtAmount: z.coerce.number().min(0).default(0),
  note: z.string().trim().max(500).optional(),
  /** Optimistic lock: the invoice's updatedAt as read — mismatch is a 409. */
  updatedAt: z.string().min(1),
})

/**
 * Recording what actually happened to a delivery (Phase B2).
 *
 * No receiver name: `sales_invoices.metadata` is not in sales' encryption map
 * (Q-004), so a third party's name would sit in plaintext at rest. The route
 * refuses a payload that carries one rather than dropping it quietly.
 *
 * Every field is optional because the office learns them at different times —
 * the date on the day, the tracking number when the carrier emails it.
 */
export const deliveryFactsSchema = z.object({
  invoiceId: z.string().uuid(),
  /** YYYY-MM-DD. The VAT point for goods, so it is the one worth chasing. */
  deliveredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  carrier: z.string().trim().max(200).optional().nullable(),
  // Blank entries are dropped by the merge rather than refused here: a stray
  // empty box in a list of parcel numbers is a typo, not a reason to reject
  // the whole save and make the operator retype the rest.
  trackingNumbers: z.array(z.string().trim().max(60)).max(20).optional(),
  address: z.string().trim().max(500).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
  /** Print prices on the ใบส่งของ. Off unless the operator turns it on. */
  showPrices: z.boolean().optional(),
  /** Optimistic lock: the invoice's updatedAt as read — mismatch is a 409. */
  updatedAt: z.string().min(1),
})

/** Minting a customer link for a quotation (rotates the acceptance token). */
export const shareSchema = z.object({
  quoteId: z.string().uuid(),
})

/** Emailing a document: the recipient plus the same selector the preview uses. */
export const sendSchema = z.object({
  to: z.string().trim().email(),
  type: z.enum(DOCUMENT_TYPES),
  template: templateSchema.optional(),
  documentId: z.string().uuid().optional(),
  /** Optional cover note; the default copy is used when blank. */
  message: z.string().trim().max(2000).optional(),
  /**
   * e-Tax Invoice by Email: CC the ETDA time-stamp system and send from the
   * RD-registered address. Only meaningful for statutory tax documents.
   */
  etax: z.boolean().optional(),
})

/** Brand profile upsert (matched by `code`); logos share the settings logo rule. */
export const brandUpsertSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,6}$/, 'รหัสแบรนด์ใช้ A-Z/0-9 ยาว 2–6 ตัว'),
  name: z.string().trim().min(1).max(120),
  brandColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable().or(z.literal('').transform(() => null)),
  logoHeader: logoSchema,
  logoFooter: logoSchema,
  logoHeaderQuotation: logoSchema,
  paymentDetails: z.string().trim().max(2000).optional().nullable(),
  documentTerms: z.string().trim().max(4000).optional().nullable(),
  quoteNumberFormat: z.string().trim().max(120).optional().nullable(),
  invoiceNumberFormat: z.string().trim().max(120).optional().nullable(),
})

export const brandDeleteSchema = z.object({ id: z.string().uuid() })

/** Switch the operator's active brand for the next documents; null = back to the default (settings) brand. */
export const brandActivateSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,6}$/).nullable(),
})

/**
 * RD reason codes for credit/debit notes (ป.82/2542 ข้อ 2–3). The label prints
 * on the sheet; the code stays in metadata for the VAT register.
 */
export const NOTE_REASONS = {
  credit: [
    { code: 'C1', label: 'ลดราคาสินค้า/บริการที่ขาย เนื่องจากผิดข้อกำหนดที่ตกลงกัน' },
    { code: 'C2', label: 'สินค้าชำรุดบกพร่อง / รับคืนสินค้า' },
    { code: 'C3', label: 'คำนวณราคาสินค้า/บริการผิดพลาดสูงกว่าที่เป็นจริง' },
    { code: 'C4', label: 'ยกเลิกการให้บริการ / บอกเลิกสัญญา' },
    { code: 'C5', label: 'จ่ายคืนเงินจ่ายล่วงหน้า เงินประกัน เงินมัดจำ' },
    { code: 'C9', label: 'เหตุอื่นตามที่กรมสรรพากรกำหนด' },
  ],
  debit: [
    { code: 'D1', label: 'เพิ่มราคาสินค้า/บริการ เนื่องจากส่งเกินกว่าที่ตกลงกัน' },
    { code: 'D2', label: 'คำนวณราคาสินค้า/บริการผิดพลาดต่ำกว่าที่เป็นจริง' },
    { code: 'D9', label: 'เหตุอื่นตามที่กรมสรรพากรกำหนด' },
  ],
} as const

export const noteLineSchema = z.object({
  description: z.string().trim().min(1).max(300),
  quantity: z.coerce.number().positive().default(1),
  /** ex-VAT unit amount */
  unitPriceNet: z.coerce.number().positive(),
})

export const noteCreateSchema = z.object({
  invoiceId: z.string().uuid(),
  kind: z.enum(['credit', 'debit']),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reasonCode: z.string().trim().min(1).max(4),
  reason: z.string().trim().max(1000).optional().nullable(),
  lines: z.array(noteLineSchema).min(1).max(20),
})

export const noteListSchema = z.object({ invoiceId: z.string().uuid() })
