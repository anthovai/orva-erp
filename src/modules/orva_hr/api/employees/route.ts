import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { badRequest } from '@open-mercato/shared/lib/crud/errors'
import { withTenantRls } from '@/lib/rls'
import { Party, PartyRole } from '@/modules/orva_party/data/entities'
import { HrEmployee } from '../../data/entities'
import { allocateHrNo } from '../../lib/payroll'
import { employeeCreateSchema, employeeListSchema, employeeUpdateSchema, deleteByIdSchema } from '../../data/validators'
import { createOrvaHrCrudOpenApi, createPagedListResponseSchema, createdSchema, okSchema } from '../openapi'

const ENTITY_ID = 'orva_hr:hr_employee' as const

type EmployeeListQuery = z.infer<typeof employeeListSchema>

const employeeListItemSchema = z
  .object({
    id: z.string().uuid(),
    employee_no: z.string().nullable().optional(),
    party_id: z.string().uuid(),
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
    fields: ['id', 'employee_no', 'party_id', 'position', 'hire_date', 'monthly_salary', 'status', 'tenant_id', 'organization_id', 'created_at', 'updated_at'],
    sortFieldMap: { id: 'id', employee_no: 'employee_no', position: 'position', hire_date: 'hire_date', status: 'status', created_at: 'created_at' },
    buildFilters: async (query: EmployeeListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.status) filters.status = query.status
      if (query.search) filters.employee_no = { $ilike: `%${query.search}%` }
      return filters
    },
  },
  create: {
    schema: employeeCreateSchema,
    mapToEntity: (input, ctx) => ({
      partyId: input.partyId,
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
    // orva_party discipline: an employee must be a party holding the role.
    beforeCreate: async (input, ctx) => {
      const tenantId = ctx.auth?.tenantId
      if (!tenantId) return
      const em = ctx.container.resolve<EntityManager>('em')
      const party = await em.findOne(Party, { id: input.partyId, tenantId, deletedAt: null })
      if (!party) throw badRequest('Party not found')
      const role = await em.findOne(PartyRole, { partyId: input.partyId, role: 'employee', tenantId, deletedAt: null })
      if (!role) throw badRequest('Party does not hold the employee role')
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
    description: 'Creates an employment record; the party must hold the employee role.',
  },
  update: { schema: employeeUpdateSchema, responseSchema: okSchema, description: 'Updates employment/compensation facts.' },
  del: { schema: deleteByIdSchema, responseSchema: okSchema, description: 'Soft-deletes an employment record.' },
})
