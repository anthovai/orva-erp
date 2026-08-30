import { z } from 'zod'

const pagedList = {
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
  withDeleted: z.coerce.boolean().optional().default(false),
  organizationId: z.string().uuid().optional(),
}

export const employeeListSchema = z
  .object({
    ...pagedList,
    sortField: z.string().optional().default('employee_no'),
    search: z.string().optional(),
    status: z.enum(['active', 'inactive']).optional(),
  })
  .passthrough()

export const employeeCreateSchema = z.object({
  partyId: z.string().uuid(),
  position: z.string().optional().nullable(),
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  monthlySalary: z.coerce.number().positive(),
  whtRate: z.coerce.number().min(0).max(100).default(0),
})

export const employeeUpdateSchema = z.object({
  id: z.string().uuid(),
  position: z.string().optional().nullable(),
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  monthlySalary: z.coerce.number().positive().optional(),
  whtRate: z.coerce.number().min(0).max(100).optional(),
  status: z.enum(['active', 'inactive']).optional(),
})

export const payrollRunListSchema = z
  .object({
    ...pagedList,
    sortField: z.string().optional().default('created_at'),
    sortDir: z.enum(['asc', 'desc']).optional().default('desc'),
    status: z.enum(['draft', 'calculated', 'posted']).optional(),
  })
  .passthrough()

export const payrollRunCreateSchema = z.object({
  monthCode: z.string().regex(/^\d{4}-\d{2}$/),
  periodId: z.string().uuid(),
  payDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export const payrollRunUpdateSchema = z.object({
  id: z.string().uuid(),
  payDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  periodId: z.string().uuid().optional(),
})

export const payrollActionSchema = z.object({ id: z.string().uuid() })

export const hrSettingsPutSchema = z.object({
  salaryExpenseAccountId: z.string().uuid(),
  ssoExpenseAccountId: z.string().uuid(),
  ssoPayableAccountId: z.string().uuid(),
  taxPayableAccountId: z.string().uuid(),
  netPayableAccountId: z.string().uuid(),
})

export const deleteByIdSchema = z.object({ id: z.string().uuid() })
