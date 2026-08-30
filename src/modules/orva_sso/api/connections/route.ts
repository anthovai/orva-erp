import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { createCrudOpenApiFactory, createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { z } from 'zod'
import { SsoConnection } from '../../data/entities'
import {
  connectionCreateSchema,
  connectionListSchema,
  connectionUpdateSchema,
  deleteByIdSchema,
} from '../../data/validators'

const ENTITY_ID = 'orva_sso:sso_connection' as const

type ConnectionListQuery = z.infer<typeof connectionListSchema>

const listItemSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    issuer_url: z.string(),
    client_id: z.string(),
    email_domains: z.string(),
    enabled: z.boolean(),
    updated_at: z.string().nullable().optional(),
  })
  .passthrough()

const buildOpenApi = createCrudOpenApiFactory({ defaultTag: 'Orva SSO' })

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['orva_sso.view'] },
    POST: { requireAuth: true, requireFeatures: ['orva_sso.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['orva_sso.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['orva_sso.manage'] },
  },
  orm: {
    entity: SsoConnection,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: connectionListSchema,
    entityId: ENTITY_ID,
    // client_secret deliberately excluded from every list/detail projection
    fields: ['id', 'name', 'issuer_url', 'client_id', 'email_domains', 'enabled', 'tenant_id', 'organization_id', 'created_at', 'updated_at'],
    sortFieldMap: { id: 'id', name: 'name', enabled: 'enabled', created_at: 'created_at' },
    buildFilters: async (query: ConnectionListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.enabled !== undefined) filters.enabled = query.enabled
      if (query.search) filters.name = { $ilike: `%${query.search}%` }
      return filters
    },
  },
  create: {
    schema: connectionCreateSchema,
    mapToEntity: (input, ctx) => ({
      name: input.name,
      issuerUrl: input.issuerUrl,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      emailDomains: input.emailDomains,
      enabled: input.enabled ?? true,
      createdBy: ctx.auth?.sub ?? null,
    }),
    response: (entity) => ({ id: String(entity.id) }),
  },
  update: {
    schema: connectionUpdateSchema,
    getId: (input) => input.id,
    applyToEntity: (entity, input) => {
      if (input.name !== undefined) entity.name = input.name
      if (input.issuerUrl !== undefined) entity.issuerUrl = input.issuerUrl
      if (input.clientId !== undefined) entity.clientId = input.clientId
      if (input.clientSecret !== undefined && input.clientSecret.length > 0) entity.clientSecret = input.clientSecret
      if (input.emailDomains !== undefined) entity.emailDomains = input.emailDomains
      if (input.enabled !== undefined) entity.enabled = input.enabled
    },
    response: () => ({ ok: true }),
  },
  del: {
    idFrom: 'body',
    softDelete: true,
    response: () => ({ ok: true }),
  },
})

export const openApi = buildOpenApi({
  resourceName: 'SSO connection',
  querySchema: connectionListSchema,
  listResponseSchema: createPagedListResponseSchema(listItemSchema),
  create: { schema: connectionCreateSchema, description: 'Create an OIDC connection (secret stored encrypted, never returned).' },
  update: { schema: connectionUpdateSchema, responseSchema: z.object({ ok: z.boolean() }), description: 'Update a connection; blank secret keeps the stored one.' },
  del: { schema: deleteByIdSchema, responseSchema: z.object({ ok: z.boolean() }), description: 'Soft-delete a connection.' },
})
