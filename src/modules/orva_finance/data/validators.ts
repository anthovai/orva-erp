import { z } from 'zod'

export const accountTypes = ['asset', 'liability', 'equity', 'income', 'expense'] as const

const pagedList = {
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
  withDeleted: z.coerce.boolean().optional().default(false),
  organizationId: z.string().uuid().optional(),
}

export const accountListSchema = z
  .object({
    ...pagedList,
    sortField: z.string().optional().default('code'),
    search: z.string().optional(),
    accountType: z.enum(accountTypes).optional(),
    isActive: z.coerce.boolean().optional(),
  })
  .passthrough()

export const accountCreateSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  accountType: z.enum(accountTypes),
  parentId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().optional().default(true),
})

export const accountUpdateSchema = z.object({
  id: z.string().uuid(),
  code: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  accountType: z.enum(accountTypes).optional(),
  parentId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().optional(),
})

export const periodListSchema = z
  .object({
    ...pagedList,
    sortField: z.string().optional().default('starts_on'),
    status: z.enum(['open', 'closed']).optional(),
  })
  .passthrough()

export const periodCreateSchema = z.object({
  code: z.string().min(1),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export const periodUpdateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['open', 'closed']).optional(),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export const journalLineInputSchema = z
  .object({
    accountId: z.string().uuid(),
    partyId: z.string().uuid().optional().nullable(),
    debit: z.coerce.number().min(0).default(0),
    credit: z.coerce.number().min(0).default(0),
    description: z.string().optional().nullable(),
  })
  .refine((line) => !(line.debit > 0 && line.credit > 0), {
    message: 'A line carries either a debit or a credit, not both',
  })
  .refine((line) => line.debit > 0 || line.credit > 0, {
    message: 'A line must carry an amount',
  })

export const journalListSchema = z
  .object({
    ...pagedList,
    sortField: z.string().optional().default('created_at'),
    sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
    status: z.enum(['draft', 'posted']).optional(),
    periodId: z.string().uuid().optional(),
    search: z.string().optional(),
  })
  .passthrough()

export const journalCreateSchema = z.object({
  periodId: z.string().uuid(),
  journalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currencyCode: z.string().min(3).max(3).default('THB'),
  memo: z.string().optional().nullable(),
  lines: z.array(journalLineInputSchema).min(2),
})

export const journalUpdateSchema = z.object({
  id: z.string().uuid(),
  journalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  periodId: z.string().uuid().optional(),
  memo: z.string().optional().nullable(),
})

export const journalPostSchema = z.object({ id: z.string().uuid() })

/** Reverse a posted journal on a date inside an open period. */
export const journalReverseSchema = z.object({
  id: z.string().uuid(),
  reversalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  memo: z.string().trim().max(500).optional(),
})

export const glSettingsPutSchema = z.object({
  retainedEarningsAccountId: z.string().uuid(),
})

export const periodCloseSchema = z.object({ periodId: z.string().uuid() })

export const deleteByIdSchema = z.object({ id: z.string().uuid() })

export const billLineInputSchema = z.object({
  expenseAccountId: z.string().uuid(),
  amount: z.coerce.number().positive(),
  description: z.string().optional().nullable(),
})

export const billListSchema = z
  .object({
    ...pagedList,
    sortField: z.string().optional().default('created_at'),
    sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
    status: z.enum(['draft', 'posted']).optional(),
    vendorPartyId: z.string().uuid().optional(),
    search: z.string().optional(),
  })
  .passthrough()

export const billCreateSchema = z.object({
  vendorPartyId: z.string().uuid(),
  vendorBillRef: z.string().optional().nullable(),
  periodId: z.string().uuid(),
  billDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  currencyCode: z.string().min(3).max(3).default('THB'),
  memo: z.string().optional().nullable(),
  lines: z.array(billLineInputSchema).min(1),
  /** ภาษีซื้อ on the bill (added on top of the expense lines). */
  taxAmount: z.coerce.number().min(0).optional().default(0),
})

export const billUpdateSchema = z.object({
  id: z.string().uuid(),
  vendorBillRef: z.string().optional().nullable(),
  billDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  periodId: z.string().uuid().optional(),
  memo: z.string().optional().nullable(),
})

export const billPostSchema = z.object({ id: z.string().uuid() })

export const apSettingsPutSchema = z.object({
  apAccountId: z.string().uuid(),
  inputVatAccountId: z.string().uuid().optional().nullable(),
  whtPayableAccountId: z.string().uuid().optional().nullable(),
})

export const paymentAllocationInputSchema = z.object({
  billId: z.string().uuid(),
  amount: z.coerce.number().positive(),
})

export const paymentListSchema = z
  .object({
    ...pagedList,
    sortField: z.string().optional().default('created_at'),
    sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
    status: z.enum(['draft', 'posted']).optional(),
    vendorPartyId: z.string().uuid().optional(),
    search: z.string().optional(),
  })
  .passthrough()

export const paymentCreateSchema = z.object({
  vendorPartyId: z.string().uuid(),
  cashAccountId: z.string().uuid(),
  periodId: z.string().uuid(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currencyCode: z.string().min(3).max(3).default('THB'),
  memo: z.string().optional().nullable(),
  allocations: z.array(paymentAllocationInputSchema).min(1),
  /** Tax withheld from the vendor — reduces cash, credits WHT payable. */
  whtAmount: z.coerce.number().min(0).optional().default(0),
  whtRate: z.coerce.number().min(0).max(100).optional().nullable(),
  whtType: z.string().trim().max(120).optional().nullable(),
})

export const paymentUpdateSchema = z.object({
  id: z.string().uuid(),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  periodId: z.string().uuid().optional(),
  cashAccountId: z.string().uuid().optional(),
  memo: z.string().optional().nullable(),
})

export const paymentPostSchema = z.object({ id: z.string().uuid() })

export const arSettingsPutSchema = z.object({
  arAccountId: z.string().uuid(),
  revenueAccountId: z.string().uuid(),
  taxAccountId: z.string().uuid().optional().nullable(),
  whtReceivableAccountId: z.string().uuid().optional().nullable(),
  defaultCashAccountId: z.string().uuid().optional().nullable(),
})

export const receiptAllocationInputSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: z.coerce.number().positive(),
})

export const receiptListSchema = z
  .object({
    ...pagedList,
    sortField: z.string().optional().default('created_at'),
    sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
    status: z.enum(['draft', 'posted']).optional(),
    search: z.string().optional(),
  })
  .passthrough()

export const receiptCreateSchema = z.object({
  cashAccountId: z.string().uuid(),
  periodId: z.string().uuid(),
  receiptDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currencyCode: z.string().min(3).max(3).default('THB'),
  memo: z.string().optional().nullable(),
  customerPartyId: z.string().uuid().optional().nullable(),
  allocations: z.array(receiptAllocationInputSchema).min(1),
  /** Withheld by the customer — part of the allocations, not of the cash. */
  whtAmount: z.coerce.number().min(0).optional().default(0),
  whtRate: z.coerce.number().min(0).max(100).optional().nullable(),
})

export const receiptUpdateSchema = z.object({
  id: z.string().uuid(),
  receiptDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  periodId: z.string().uuid().optional(),
  cashAccountId: z.string().uuid().optional(),
  memo: z.string().optional().nullable(),
})

export const receiptPostSchema = z.object({ id: z.string().uuid() })

export const arPostSchema = z.object({
  invoiceIds: z.array(z.string().uuid()).min(1).max(100),
  periodId: z.string().uuid(),
  postingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

// ---- fixed assets
export const assetListSchema = z
  .object({
    ...pagedList,
    sortField: z.string().optional().default('code'),
    sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
    status: z.enum(['active', 'disposed']).optional(),
    search: z.string().optional(),
  })
  .passthrough()

export const assetCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().max(120).optional().nullable(),
  acquiredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cost: z.coerce.number().positive(),
  salvage: z.coerce.number().min(0).optional().default(0),
  usefulLifeMonths: z.coerce.number().int().min(1).max(600),
  assetAccountId: z.string().uuid(),
  accumDeprAccountId: z.string().uuid(),
  expenseAccountId: z.string().uuid(),
  notes: z.string().trim().max(1000).optional().nullable(),
})

export const assetUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  category: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  status: z.enum(['active', 'disposed']).optional(),
  disposedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
})

/** Run straight-line depreciation for every active asset for one period. */
export const depreciateSchema = z.object({
  periodId: z.string().uuid(),
  /** posting date inside the period (default: period end) */
  postingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

// ---- bank reconciliation
export const bankStatementImportSchema = z.object({
  accountId: z.string().uuid(),
  lines: z
    .array(
      z.object({
        txnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        description: z.string().trim().max(500).optional().nullable(),
        reference: z.string().trim().max(120).optional().nullable(),
        /** signed: deposit +, withdrawal - */
        amount: z.coerce.number().refine((n) => n !== 0, 'amount must not be zero'),
      }),
    )
    .min(1)
    .max(2000),
})

export const bankStatementListSchema = z.object({
  accountId: z.string().uuid(),
  status: z.enum(['unmatched', 'matched', 'excluded']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export const bankStatementMatchSchema = z.object({
  lineId: z.string().uuid(),
  /** the posted GL line to pin; null when unmatching or excluding */
  journalLineId: z.string().uuid().nullable(),
  status: z.enum(['matched', 'unmatched', 'excluded']).optional(),
})

