import { z } from 'zod'

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const stockSettingsPutSchema = z.object({
  inventoryAccountId: z.string().uuid().nullable().optional(),
  cogsAccountId: z.string().uuid().nullable().optional(),
  warehouseId: z.string().uuid().nullable().optional(),
  locationId: z.string().uuid().nullable().optional(),
})

/** Receive one lot into stock, usually straight off a posted OEM bill line. */
export const receiveSchema = z.object({
  catalogVariantId: z.string().uuid(),
  quantity: z.coerce.number().positive(),
  /** Unit cost ex-VAT. When omitted and a bill line is given, amount ÷ quantity. */
  unitCost: z.coerce.number().min(0).optional(),
  billId: z.string().uuid().optional().nullable(),
  billLineId: z.string().uuid().optional().nullable(),
  lotNumber: z.string().trim().min(1).max(120),
  manufacturedOn: isoDate.optional().nullable(),
  expiresOn: isoDate.optional().nullable(),
  receivedOn: isoDate,
  reason: z.string().trim().max(500).optional(),
  /**
   * What this receipt belongs to, stamped on the WMS movement so another
   * module can find its own receipts again. Additive and optional: without
   * them the route behaves exactly as before, deriving 'po' from a bill id.
   * `orva_purchasing` passes 'po' with the order id and the line id, which is
   * what makes its repair pass possible.
   */
  referenceType: z.enum(['po', 'bill', 'manual']).optional(),
  referenceId: z.string().uuid().optional().nullable(),
  poLineId: z.string().uuid().optional().nullable(),
})

export const retailSaleLineSchema = z.object({
  catalogVariantId: z.string().uuid(),
  lotId: z.string().uuid(),
  name: z.string().trim().min(1).max(300),
  sku: z.string().trim().max(120).optional().nullable(),
  quantity: z.coerce.number().positive(),
  /** Shelf price per unit, VAT included. */
  unitPriceGross: z.coerce.number().min(0),
})

/** A retail (B2C) sale: invoice in the brand's series, paid on the spot, stock issued from the chosen lots. */
export const retailSaleSchema = z.object({
  brand: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,6}$/).optional(),
  customerName: z.string().trim().max(200).optional().nullable(),
  customerPhone: z.string().trim().max(50).optional().nullable(),
  soldOn: isoDate,
  paymentMethod: z.enum(['cash', 'transfer', 'marketplace']).default('transfer'),
  reference: z.string().trim().max(120).optional().nullable(),
  lines: z.array(retailSaleLineSchema).min(1).max(50),
})

/** A normalized marketplace order, as the preview showed it and the import will record it. */
export const marketplaceOrderSchema = z.object({
  externalOrderId: z.string().trim().min(1).max(120),
  orderDate: isoDate.nullable().optional(),
  buyerName: z.string().trim().max(200).nullable().optional(),
  lines: z.array(z.object({
    sku: z.string().trim().min(1).max(120),
    productName: z.string().trim().max(300).nullable().optional(),
    quantity: z.coerce.number().positive(),
    unitPrice: z.coerce.number().positive(),
  })).min(1).max(50),
})

export const marketplaceImportSchema = z.object({
  marketplace: z.enum(['shopee', 'lazada', 'tiktok', 'custom']),
  brand: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,6}$/).optional(),
  orders: z.array(marketplaceOrderSchema).min(1).max(500),
})

export const marketplaceHistoryQuerySchema = z.object({
  marketplace: z.enum(['shopee', 'lazada', 'tiktok', 'custom']).optional(),
  pageSize: z.coerce.number().int().min(1).max(500).optional().default(200),
})

export const valuationQuerySchema = z.object({
  asOf: isoDate.optional(),
})

export const lotsQuerySchema = z.object({
  catalogVariantId: z.string().uuid().optional(),
  /** include lots with zero on hand */
  all: z.enum(['0', '1']).optional(),
})

export const postCogsSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
})
