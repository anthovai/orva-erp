import { z } from 'zod'
import { isValidThaiNationalId } from '../lib/statutory'

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


/**
 * Statutory identity. Optional throughout: an employee is created the moment
 * they are hired and the paperwork is chased afterwards. The national id is
 * checked against its own check digit, because a filing is a bad place to
 * discover a typo. Empty string clears the field.
 */
const clearableText = (max: number) =>
  z.union([z.null(), z.literal('').transform(() => null), z.string().trim().max(max)]).optional()

const nationalIdSchema = z
  .union([
    z.null(),
    z.literal('').transform(() => null),
    z.string().trim().refine((v) => isValidThaiNationalId(v), { message: 'orva_hr.errors.nationalId' }).transform((v) => v.replace(/\D/g, '')),
  ])
  .optional()

const statutoryFields = {
  titleTh: clearableText(40),
  firstNameTh: clearableText(120),
  lastNameTh: clearableText(120),
  nationalId: nationalIdSchema,
  ssoNumber: z.union([z.null(), z.literal('').transform(() => null), z.string().trim().max(30)]).optional(),
  address: clearableText(500),
  bankName: clearableText(120),
  bankAccountNo: clearableText(40),
  terminationDate: z.union([z.null(), z.literal('').transform(() => null), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),
}

export const employeeCreateSchema = z.object({
  /** The staff:staff_team_member this employment record belongs to. */
  staffMemberId: z.string().uuid(),
  position: z.string().optional().nullable(),
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  monthlySalary: z.coerce.number().positive(),
  ...statutoryFields,
})

export const employeeUpdateSchema = z.object({
  id: z.string().uuid(),
  /** Relink to a different staff member; the name snapshot follows. */
  staffMemberId: z.string().uuid().optional(),
  position: z.string().optional().nullable(),
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  monthlySalary: z.coerce.number().positive().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  ...statutoryFields,
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
  /**
   * Filing registration. Optional: the posting accounts are what payroll
   * needs to run, these are what the returns need to be filed, and a tenant
   * reaches the second stage later.
   */
  ssoEmployerNo: clearableText(30),
  ssoBranchCode: clearableText(20),
  filerName: clearableText(200),
  filerPosition: clearableText(120),
})

export const deleteByIdSchema = z.object({ id: z.string().uuid() })
