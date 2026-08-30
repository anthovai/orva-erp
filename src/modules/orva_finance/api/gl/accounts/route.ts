import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { GlAccount } from '../../../data/entities'
import { accountCreateSchema, accountListSchema, accountUpdateSchema, deleteByIdSchema } from '../../../data/validators'
import { createOrvaFinanceCrudOpenApi, createPagedListResponseSchema, createdSchema, okSchema } from '../../openapi'

const ENTITY_ID = 'orva_finance:gl_account' as const

type AccountListQuery = z.infer<typeof accountListSchema>

const accountListItemSchema = z
  .object({
    id: z.string().uuid(),
    code: z.string(),
    name: z.string(),
    account_type: z.string(),
    parent_id: z.string().uuid().nullable().optional(),
    is_active: z.boolean().optional(),
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
    entity: GlAccount,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: accountListSchema,
    entityId: ENTITY_ID,
    fields: ['id', 'code', 'name', 'account_type', 'parent_id', 'is_active', 'tenant_id', 'organization_id', 'created_at', 'updated_at'],
    sortFieldMap: { id: 'id', code: 'code', name: 'name', account_type: 'account_type', created_at: 'created_at' },
    buildFilters: async (query: AccountListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.accountType) filters.account_type = query.accountType
      if (query.isActive !== undefined) filters.is_active = query.isActive
      if (query.search) {
        filters.$or = [
          { code: { $ilike: `%${escapeLikePattern(query.search)}%` } },
          { name: { $ilike: `%${escapeLikePattern(query.search)}%` } },
        ]
      }
      return filters
    },
  },
  create: {
    schema: accountCreateSchema,
    mapToEntity: (input, ctx) => ({
      code: input.code,
      name: input.name,
      accountType: input.accountType,
      parentId: input.parentId ?? null,
      isActive: input.isActive ?? true,
      createdBy: ctx.auth?.sub ?? null,
    }),
    response: (entity) => ({ id: String(entity.id) }),
  },
  update: {
    schema: accountUpdateSchema,
    getId: (input) => input.id,
    applyToEntity: (entity, input) => {
      if (input.code !== undefined) entity.code = input.code
      if (input.name !== undefined) entity.name = input.name
      if (input.accountType !== undefined) entity.accountType = input.accountType
      if (input.parentId !== undefined) entity.parentId = input.parentId
      if (input.isActive !== undefined) entity.isActive = input.isActive
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
  resourceName: 'GL Account',
  pluralName: 'GL Accounts',
  querySchema: accountListSchema,
  listResponseSchema: createPagedListResponseSchema(accountListItemSchema),
  create: { schema: accountCreateSchema, responseSchema: createdSchema, description: 'Creates a chart-of-accounts entry.' },
  update: { schema: accountUpdateSchema, responseSchema: okSchema, description: 'Updates a GL account.' },
  del: { schema: deleteByIdSchema, responseSchema: okSchema, description: 'Soft-deletes a GL account.' },
})
