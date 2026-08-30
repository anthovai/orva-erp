import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { FiscalPeriod } from '../../../data/entities'
import { periodCreateSchema, periodListSchema, periodUpdateSchema, deleteByIdSchema } from '../../../data/validators'
import { createOrvaFinanceCrudOpenApi, createPagedListResponseSchema, createdSchema, okSchema } from '../../openapi'

const ENTITY_ID = 'orva_finance:fiscal_period' as const

type PeriodListQuery = z.infer<typeof periodListSchema>

const periodListItemSchema = z
  .object({
    id: z.string().uuid(),
    code: z.string(),
    starts_on: z.string(),
    ends_on: z.string(),
    status: z.string(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
  })
  .passthrough()

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['orva_finance.gl.view'] },
    POST: { requireAuth: true, requireFeatures: ['orva_finance.gl.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['orva_finance.gl.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['orva_finance.gl.manage'] },
  },
  orm: {
    entity: FiscalPeriod,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: periodListSchema,
    entityId: ENTITY_ID,
    fields: ['id', 'code', 'starts_on', 'ends_on', 'status', 'tenant_id', 'organization_id', 'created_at', 'updated_at'],
    sortFieldMap: { id: 'id', code: 'code', starts_on: 'starts_on', status: 'status', created_at: 'created_at' },
    buildFilters: async (query: PeriodListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.status) filters.status = query.status
      return filters
    },
  },
  create: {
    schema: periodCreateSchema,
    mapToEntity: (input, ctx) => ({
      code: input.code,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      status: 'open',
      createdBy: ctx.auth?.sub ?? null,
    }),
    response: (entity) => ({ id: String(entity.id) }),
  },
  update: {
    schema: periodUpdateSchema,
    getId: (input) => input.id,
    applyToEntity: (entity, input) => {
      if (input.status !== undefined) entity.status = input.status
      if (input.startsOn !== undefined) entity.startsOn = input.startsOn
      if (input.endsOn !== undefined) entity.endsOn = input.endsOn
    },
    response: () => ({ ok: true }),
  },
  del: {
    idFrom: 'body',
    softDelete: true,
    response: () => ({ ok: true }),
  },
})

export const openApi = createOrvaFinanceCrudOpenApi({
  resourceName: 'Fiscal Period',
  pluralName: 'Fiscal Periods',
  querySchema: periodListSchema,
  listResponseSchema: createPagedListResponseSchema(periodListItemSchema),
  create: { schema: periodCreateSchema, responseSchema: createdSchema, description: 'Creates an open fiscal period.' },
  update: { schema: periodUpdateSchema, responseSchema: okSchema, description: 'Updates a fiscal period (including open/close).' },
  del: { schema: deleteByIdSchema, responseSchema: okSchema, description: 'Soft-deletes a fiscal period.' },
})
