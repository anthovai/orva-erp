import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { badRequest } from '@open-mercato/shared/lib/crud/errors'
import { withTenantRls } from '@/lib/rls'
import { PayrollRun } from '../../data/entities'
import { allocateHrNo } from '../../lib/payroll'
import { payrollRunCreateSchema, payrollRunListSchema, payrollRunUpdateSchema, deleteByIdSchema } from '../../data/validators'
import { createOrvaHrCrudOpenApi, createPagedListResponseSchema, createdSchema, okSchema } from '../openapi'

const ENTITY_ID = 'orva_hr:payroll_run' as const

type RunListQuery = z.infer<typeof payrollRunListSchema>

const runListItemSchema = z
  .object({
    id: z.string().uuid(),
    run_no: z.string().nullable().optional(),
    status: z.string(),
    month_code: z.string(),
    period_id: z.string().uuid(),
    pay_date: z.string(),
    total_gross: z.union([z.string(), z.number()]).optional(),
    total_net: z.union([z.string(), z.number()]).optional(),
    engine_version: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
  })
  .passthrough()

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['orva_hr.payroll.view'] },
    POST: { requireAuth: true, requireFeatures: ['orva_hr.payroll.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['orva_hr.payroll.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['orva_hr.payroll.manage'] },
  },
  orm: {
    entity: PayrollRun,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: payrollRunListSchema,
    entityId: ENTITY_ID,
    fields: [
      'id', 'run_no', 'status', 'month_code', 'period_id', 'pay_date',
      'total_gross', 'total_sso_employee', 'total_sso_employer', 'total_wht', 'total_net',
      'engine_version', 'journal_id', 'tenant_id', 'organization_id', 'created_at', 'updated_at',
    ],
    sortFieldMap: { id: 'id', run_no: 'run_no', status: 'status', month_code: 'month_code', pay_date: 'pay_date', created_at: 'created_at' },
    buildFilters: async (query: RunListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.status) filters.status = query.status
      return filters
    },
  },
  create: {
    schema: payrollRunCreateSchema,
    mapToEntity: (input, ctx) => ({
      status: 'draft',
      monthCode: input.monthCode,
      periodId: input.periodId,
      payDate: input.payDate,
      createdBy: ctx.auth?.sub ?? null,
    }),
    response: (entity) => ({ id: String(entity.id) }),
  },
  update: {
    schema: payrollRunUpdateSchema,
    getId: (input) => input.id,
    applyToEntity: (entity, input) => {
      if (entity.status === 'posted') throw badRequest('Posted payroll runs are immutable')
      if (input.payDate !== undefined) entity.payDate = input.payDate
      if (input.periodId !== undefined) entity.periodId = input.periodId
    },
    response: () => ({ ok: true }),
  },
  del: {
    idFrom: 'body',
    softDelete: true,
    response: () => ({ ok: true }),
  },
  hooks: {
    beforeDelete: async (id, ctx) => {
      const em = ctx.container.resolve<EntityManager>('em')
      const run = await em.findOne(PayrollRun, { id })
      if (run?.status === 'posted') throw badRequest('Posted payroll runs cannot be deleted')
    },
    afterCreate: async (entity, ctx) => {
      const tenantId = ctx.auth?.tenantId
      if (!tenantId) return
      const em = ctx.container.resolve<EntityManager>('em')
      await withTenantRls(em, tenantId, async (tem) => {
        const runNo = await allocateHrNo(tem, tenantId, String(entity.organizationId), 'payroll_run', 'PRUN')
        const managed = await tem.findOne(PayrollRun, { id: entity.id })
        if (managed) {
          managed.runNo = runNo
          await tem.flush()
        }
      })
    },
  },
})

export const openApi = createOrvaHrCrudOpenApi({
  resourceName: 'Payroll Run',
  pluralName: 'Payroll Runs',
  querySchema: payrollRunListSchema,
  listResponseSchema: createPagedListResponseSchema(runListItemSchema),
  create: {
    schema: payrollRunCreateSchema,
    responseSchema: createdSchema,
    description: 'Creates a draft payroll run for a month (one per month per organization).',
  },
  update: { schema: payrollRunUpdateSchema, responseSchema: okSchema, description: 'Updates a DRAFT/CALCULATED run.' },
  del: { schema: deleteByIdSchema, responseSchema: okSchema, description: 'Soft-deletes a non-posted run.' },
})
