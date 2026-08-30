import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { PartyLink } from '../../data/entities'
import { partyLinkCreateSchema, partyLinkListSchema, deleteByIdSchema } from '../../data/validators'
import { createOrvaPartyCrudOpenApi, createPagedListResponseSchema, createdSchema, okSchema } from '../openapi'

const ENTITY_ID = 'orva_party:party_link' as const

type LinkListQuery = z.infer<typeof partyLinkListSchema>

const linkListItemSchema = z
  .object({
    id: z.string().uuid(),
    party_id: z.string().uuid(),
    target_entity: z.string(),
    target_id: z.string().uuid(),
    tenant_id: z.string().nullable().optional(),
    organization_id: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
  })
  .passthrough()

export const { metadata, GET, POST, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['orva_party.parties.view'] },
    POST: { requireAuth: true, requireFeatures: ['orva_party.parties.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['orva_party.parties.manage'] },
  },
  orm: {
    entity: PartyLink,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: partyLinkListSchema,
    entityId: ENTITY_ID,
    fields: ['id', 'party_id', 'target_entity', 'target_id', 'tenant_id', 'organization_id', 'created_at', 'updated_at'],
    sortFieldMap: { id: 'id', target_entity: 'target_entity', created_at: 'created_at' },
    buildFilters: async (query: LinkListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.partyId) filters.party_id = query.partyId
      if (query.targetEntity) filters.target_entity = query.targetEntity
      if (query.targetId) filters.target_id = query.targetId
      return filters
    },
  },
  create: {
    schema: partyLinkCreateSchema,
    mapToEntity: (input, ctx) => ({
      partyId: input.partyId,
      targetEntity: input.targetEntity,
      targetId: input.targetId,
      createdBy: ctx.auth?.sub ?? null,
    }),
    response: (entity) => ({ id: String(entity.id) }),
  },
  del: {
    idFrom: 'body',
    softDelete: true,
    response: () => ({ ok: true }),
  },
})

export const openApi = createOrvaPartyCrudOpenApi({
  resourceName: 'Party Link',
  pluralName: 'Party Links',
  querySchema: partyLinkListSchema,
  listResponseSchema: createPagedListResponseSchema(linkListItemSchema),
  create: {
    schema: partyLinkCreateSchema,
    responseSchema: createdSchema,
    description: 'Links a party to a record owned by another module (customer entity, staff member, user).',
  },
  del: {
    schema: deleteByIdSchema,
    responseSchema: okSchema,
    description: 'Soft-deletes a party link.',
  },
})
