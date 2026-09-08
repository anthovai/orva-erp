import { z } from 'zod'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ต้องเป็นวันที่รูปแบบ YYYY-MM-DD')

export const PO_LINE_KINDS = ['goods', 'service'] as const
export const VAT_MODES = ['none', '7'] as const

/**
 * One ordered line. A goods line must name a catalog variant — it is the only
 * way the receipt can create the right WMS lot later, and an order for
 * "something" is not an order.
 */
export const lineInputSchema = z
  .object({
    kind: z.enum(PO_LINE_KINDS),
    catalogVariantId: z.string().uuid().nullable().optional(),
    description: z.string().trim().min(1).max(300),
    sku: z.string().trim().max(120).nullable().optional(),
    quantity: z.coerce.number().positive().max(1_000_000),
    unit: z.string().trim().max(40).nullable().optional(),
    unitPrice: z.coerce.number().min(0).max(1_000_000_000),
    vatMode: z.enum(VAT_MODES).default('7'),
    accountId: z.string().uuid(),
    expectedOn: isoDate.nullable().optional(),
  })
  .refine((line) => line.kind !== 'goods' || Boolean(line.catalogVariantId), {
    message: 'บรรทัดสินค้าต้องเลือกสินค้าจากแค็ตตาล็อก',
    path: ['catalogVariantId'],
  })

export const orderCreateSchema = z.object({
  vendorPartyId: z.string().uuid(),
  orderDate: isoDate,
  expectedOn: isoDate.nullable().optional(),
  memo: z.string().trim().max(2000).nullable().optional(),
  vendorReference: z.string().trim().max(120).nullable().optional(),
  lines: z.array(lineInputSchema).min(1).max(100),
})

/**
 * A draft accepts everything; a sent order accepts only the three fields that
 * do not change what was promised. The route enforces which, because the
 * distinction depends on stored state the schema cannot see.
 */
export const orderUpdateSchema = z.object({
  id: z.string().uuid(),
  updatedAt: z.string().min(1),
  vendorPartyId: z.string().uuid().optional(),
  orderDate: isoDate.optional(),
  expectedOn: isoDate.nullable().optional(),
  memo: z.string().trim().max(2000).nullable().optional(),
  vendorReference: z.string().trim().max(120).nullable().optional(),
  lines: z.array(lineInputSchema).min(1).max(100).optional(),
})

export const orderListSchema = z.object({
  /** open = everything still worth looking at; all = including closed/cancelled. */
  bucket: z.enum(['open', 'all']).default('open'),
  status: z.enum(['draft', 'sent', 'partially_received', 'received', 'closed', 'cancelled']).optional(),
  vendorPartyId: z.string().uuid().optional(),
  late: z.enum(['0', '1']).optional(),
  search: z.string().trim().max(200).optional(),
})

export const orderIdParamsSchema = z.object({ id: z.string().uuid() })
export const lineIdParamsSchema = z.object({ id: z.string().uuid(), lineId: z.string().uuid() })

export const deleteByIdSchema = z.object({ id: z.string().uuid() })

/** Every mutation that is not a plain edit still carries the version it read. */
export const versionedSchema = z.object({ updatedAt: z.string().min(1) })

/** Cancelling and closing both demand a reason — the record is the point. */
export const reasonedSchema = z.object({
  updatedAt: z.string().min(1),
  reason: z.string().trim().min(1).max(500),
})

export const adjustQuantitySchema = z.object({
  updatedAt: z.string().min(1),
  quantity: z.coerce.number().positive().max(1_000_000),
  reason: z.string().trim().min(1).max(500),
})

export const settingsPutSchema = z.object({
  poNumberFormat: z.string().trim().min(3).max(120).optional(),
  defaultGoodsAccountId: z.string().uuid().nullable().optional(),
  defaultServiceAccountId: z.string().uuid().nullable().optional(),
  vatDefault: z.enum(VAT_MODES).optional(),
})

export type LineInput = z.infer<typeof lineInputSchema>
export type OrderCreateInput = z.infer<typeof orderCreateSchema>
export type OrderUpdateInput = z.infer<typeof orderUpdateSchema>
