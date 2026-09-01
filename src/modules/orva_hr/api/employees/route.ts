import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { badRequest } from '@open-mercato/shared/lib/crud/errors'
import { withTenantRls } from '@/lib/rls'
import { HrEmployee } from '../../data/entities'
import { allocateHrNo } from '../../lib/payroll'
import { employeeCreateSchema, employeeListSchema, employeeUpdateSchema, deleteByIdSchema } from '../../data/validators'
import { createOrvaHrCrudOpenApi, createPagedListResponseSchema, createdSchema, okSchema } from '../openapi'

const ENTITY_ID = 'orva_hr:hr_employee' as const

/**
 * Validates the link target and returns the name to snapshot.
 *
 * Raw SQL on staff_team_members: cross-module ORM relations are not allowed,
 * and this read runs inside the request's tenant scope. The duplicate check
 * mirrors the partial unique index so the operator gets a message instead of
 * a constraint error.
 */
async function resolveStaffMember(
  ctx: { auth?: { tenantId?: string | null } | null; container: { resolve: <T>(name: string) => T } },
  staffMemberId: string,
  excludeEmployeeId?: string,
): Promise<string> {
  const tenantId = ctx.auth?.tenantId
  if (!tenantId) throw badRequest('Tenant scope is required')
  const em = ctx.container.resolve<EntityManager>('em')
  return withTenantRls(em, tenantId, async (tem) => {
    const members = (await tem.execute(
      `select display_name from staff_team_members
       where id = ?::uuid and tenant_id = ?::uuid and deleted_at is null`,
      [staffMemberId, tenantId],
    )) as Array<{ display_name: string }>
    if (!members[0]) throw badRequest('Staff member not found')
    const linked = await tem.findOne(HrEmployee, {
      staffMemberId,
      tenantId,
      deletedAt: null,
      ...(excludeEmployeeId ? { id: { $ne: excludeEmployeeId } } : {}),
    })
    if (linked) throw badRequest('This staff member already has an employee record')
    return String(members[0].display_name)
  })
}

type EmployeeListQuery = z.infer<typeof employeeListSchema>

const employeeListItemSchema = z
  .object({
    id: z.string().uuid(),
    employee_no: z.string().nullable().optional(),
    party_id: z.string().uuid().nullable().optional(),
    staff_member_id: z.string().uuid().nullable().optional(),
    display_name: z.string().nullable().optional(),
    position: z.string().nullable().optional(),
    hire_date: z.string().nullable().optional(),
    monthly_salary: z.union([z.string(), z.number()]).optional(),
    status: z.string(),
    updated_at: z.string().nullable().optional(),
  })
  .passthrough()

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['orva_hr.employees.view'] },
    POST: { requireAuth: true, requireFeatures: ['orva_hr.employees.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['orva_hr.employees.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['orva_hr.employees.manage'] },
  },
  orm: {
    entity: HrEmployee,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: employeeListSchema,
    entityId: ENTITY_ID,
    fields: ['id', 'employee_no', 'party_id', 'staff_member_id', 'display_name', 'position', 'hire_date', 'monthly_salary', 'status', 'tenant_id', 'organization_id', 'created_at', 'updated_at'],
    sortFieldMap: { id: 'id', employee_no: 'employee_no', position: 'position', hire_date: 'hire_date', status: 'status', created_at: 'created_at' },
    buildFilters: async (query: EmployeeListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.status) filters.status = query.status
      if (query.search) {
        filters.$or = [
          { employee_no: { $ilike: `%${query.search}%` } },
          { display_name: { $ilike: `%${query.search}%` } },
        ]
      }
      return filters
    },
  },
  create: {
    schema: employeeCreateSchema,
    mapToEntity: (input, ctx) => ({
      staffMemberId: input.staffMemberId,
      // set by beforeCreate from the staff member row — never client-supplied
      displayName: (input as { displayName?: string }).displayName ?? null,
      position: input.position ?? null,
      hireDate: input.hireDate ?? null,
      monthlySalary: Number(input.monthlySalary).toFixed(4),
      status: 'active',
      createdBy: ctx.auth?.sub ?? null,
    }),
    response: (entity) => ({ id: String(entity.id) }),
  },
  update: {
    schema: employeeUpdateSchema,
    getId: (input) => input.id,
    applyToEntity: (entity, input) => {
      if (input.staffMemberId !== undefined) {
        entity.staffMemberId = input.staffMemberId
        const nextName = (input as { displayName?: string }).displayName
        if (nextName) entity.displayName = nextName
      }
      if (input.position !== undefined) entity.position = input.position
      if (input.hireDate !== undefined) entity.hireDate = input.hireDate
      if (input.monthlySalary !== undefined) entity.monthlySalary = Number(input.monthlySalary).toFixed(4)
      if (input.status !== undefined) entity.status = input.status
    },
    response: () => ({ ok: true }),
  },
  del: {
    idFrom: 'body',
    softDelete: true,
    response: () => ({ ok: true }),
  },
  hooks: {
    // The employee IS a staff member wearing a payroll hat: validate the
    // member exists in this tenant, refuse a second employment record for
    // the same person, and take the name snapshot server-side.
    beforeCreate: async (input, ctx) => {
      const displayName = await resolveStaffMember(ctx, input.staffMemberId)
      return { ...input, displayName } as typeof input
    },
    beforeUpdate: async (input, ctx) => {
      if (!input.staffMemberId) return
      const displayName = await resolveStaffMember(ctx, input.staffMemberId, input.id)
      return { ...input, displayName } as typeof input
    },
    afterCreate: async (entity, ctx) => {
      const tenantId = ctx.auth?.tenantId
      if (!tenantId) return
      const em = ctx.container.resolve<EntityManager>('em')
      await withTenantRls(em, tenantId, async (tem) => {
        const employeeNo = await allocateHrNo(tem, tenantId, String(entity.organizationId), 'employee', 'EMP')
        const managed = await tem.findOne(HrEmployee, { id: entity.id })
        if (managed) {
          managed.employeeNo = employeeNo
          await tem.flush()
        }
      })
    },
  },
})

export const openApi = createOrvaHrCrudOpenApi({
  resourceName: 'Employee',
  pluralName: 'Employees',
  querySchema: employeeListSchema,
  listResponseSchema: createPagedListResponseSchema(employeeListItemSchema),
  create: {
    schema: employeeCreateSchema,
    responseSchema: createdSchema,
    description: 'Creates an employment record linked to a staff team member; one record per member.',
  },
  update: { schema: employeeUpdateSchema, responseSchema: okSchema, description: 'Updates employment/compensation facts.' },
  del: { schema: deleteByIdSchema, responseSchema: okSchema, description: 'Soft-deletes an employment record.' },
})
