import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { PartyRole } from '../../data/entities'
import {
  partyRoleCreateSchema,
  partyRoleListSchema,
  partyRoleUpdateSchema,
  deleteByIdSchema,
} from '../../data/validators'
import { createOrvaPartyCrudOpenApi, createPagedListResponseSchema, createdSchema, okSchema } from '../openapi'

const ENTITY_ID = 'orva_party:party_role' as const

type RoleListQuery = z.infer<typeof partyRoleListSchema>

const roleListItemSchema = z
  .object({
    id: z.string().uuid(),
    party_id: z.string().uuid(),
    role: z.string(),
    tenant_id: z.string().nullable().optional(),
    organization_id: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
  })
  .passthrough()

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['orva_party.parties.view'] },
    POST: { requireAuth: true, requireFeatures: ['orva_party.parties.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['orva_party.parties.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['orva_party.parties.manage'] },
  },
  orm: {
    entity: PartyRole,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: partyRoleListSchema,
    entityId: ENTITY_ID,
    fields: ['id', 'party_id', 'role', 'config_json', 'tenant_id', 'organization_id', 'created_at', 'updated_at'],
    sortFieldMap: { id: 'id', role: 'role', created_at: 'created_at' },
    buildFilters: async (query: RoleListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.partyId) filters.party_id = query.partyId
      if (query.role) filters.role = query.role
      return filters
    },
  },
  create: {
    schema: partyRoleCreateSchema,
    mapToEntity: (input, ctx) => ({
      partyId: input.partyId,
      role: input.role,
      configJson: input.configJson ?? null,
      createdBy: ctx.auth?.sub ?? null,
    }),
    response: (entity) => ({ id: String(entity.id) }),
  },
  update: {
    schema: partyRoleUpdateSchema,
    getId: (input) => input.id,
    applyToEntity: (entity, input) => {
      if (input.role !== undefined) entity.role = input.role
      if (input.configJson !== undefined) entity.configJson = input.configJson
    },
    response: () => ({ ok: true }),
  },
  del: {
    idFrom: 'body',
    softDelete: true,
    response: () => ({ ok: true }),
  },
})

export const openApi = createOrvaPartyCrudOpenApi({
  resourceName: 'Party Role',
  pluralName: 'Party Roles',
  querySchema: partyRoleListSchema,
  listResponseSchema: createPagedListResponseSchema(roleListItemSchema),
  create: {
    schema: partyRoleCreateSchema,
    responseSchema: createdSchema,
    description: 'Assigns a business role (customer, vendor, employee, ...) to a party.',
  },
  update: {
    schema: partyRoleUpdateSchema,
    responseSchema: okSchema,
    description: 'Updates a party role assignment.',
  },
  del: {
    schema: deleteByIdSchema,
    responseSchema: okSchema,
    description: 'Soft-deletes a party role assignment.',
  },
})
