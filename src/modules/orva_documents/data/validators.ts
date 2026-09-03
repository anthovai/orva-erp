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
