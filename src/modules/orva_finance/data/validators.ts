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

export const apSettingsPutSchema = z.object({ apAccountId: z.string().uuid() })
