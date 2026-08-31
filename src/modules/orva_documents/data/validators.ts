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
})

export const previewQuerySchema = z.object({
  type: z.enum(DOCUMENT_TYPES),
  template: templateSchema.optional(),
  /** Sales document to render; sample data is used when absent. */
  documentId: z.string().uuid().optional(),
})
