import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { withTenantRls } from '@/lib/rls'
import { Party, PartyRole } from '../../data/entities'
import {
  partyCreateSchema,
  partyListSchema,
  partyUpdateSchema,
  deleteByIdSchema,
} from '../../data/validators'
import { createOrvaPartyCrudOpenApi, createPagedListResponseSchema, createdSchema, okSchema } from '../openapi'

const ENTITY_ID = 'orva_party:party' as const

type PartyListQuery = z.infer<typeof partyListSchema>

const partyListItemSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.string(),
    display_name: z.string(),
    legal_name: z.string().nullable().optional(),
    tax_id: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    tenant_id: z.string().nullable().optional(),
    organization_id: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
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
    entity: Party,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: partyListSchema,
    entityId: ENTITY_ID,
    fields: [
      'id',
      'kind',
      'display_name',
      'legal_name',
      'tax_id',
      'email',
      'phone',
      'notes',
      'tenant_id',
      'organization_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      id: 'id',
      kind: 'kind',
      display_name: 'display_name',
      email: 'email',
      created_at: 'created_at',
      updated_at: 'updated_at',
    },
    buildFilters: async (query: PartyListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.kind) filters.kind = query.kind
      if (query.search) {
        filters.display_name = { $ilike: `%${escapeLikePattern(query.search)}%` }
      }
      return filters
    },
  },
  create: {
    schema: partyCreateSchema,
    mapToEntity: (input, ctx) => ({
      kind: input.kind,
      displayName: input.displayName,
      legalName: input.legalName ?? null,
      taxId: input.taxId ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      notes: input.notes ?? null,
      createdBy: ctx.auth?.sub ?? null,
    }),
    response: (entity) => ({ id: String(entity.id) }),
  },
  update: {
    schema: partyUpdateSchema,
    getId: (input) => input.id,
    applyToEntity: (entity, input) => {
      if (input.kind !== undefined) entity.kind = input.kind
      if (input.displayName !== undefined) entity.displayName = input.displayName
      if (input.legalName !== undefined) entity.legalName = input.legalName
      if (input.taxId !== undefined) entity.taxId = input.taxId
      if (input.email !== undefined) entity.email = input.email
      if (input.phone !== undefined) entity.phone = input.phone
      if (input.notes !== undefined) entity.notes = input.notes
    },
    response: () => ({ ok: true }),
  },
  del: {
    idFrom: 'body',
    softDelete: true,
    response: () => ({ ok: true }),
  },
  hooks: {
    // Initial roles come with the create payload; they are written inside a
    // withTenantRls transaction so the database itself enforces the tenant
    // boundary on the extra rows (Orva RLS rule, see CLAUDE.md).
    afterCreate: async (entity, ctx) => {
      const auth = ctx.auth
      const tenantId = auth?.tenantId
      if (!auth || !tenantId) return
      const roles = Array.from(new Set(ctx.input?.roles ?? [])).filter(Boolean)
      if (roles.length === 0) return
      const em = ctx.container.resolve<EntityManager>('em')
      await withTenantRls(em, tenantId, async (tem) => {
        const now = new Date()
        for (const role of roles) {
          tem.persist(
            tem.create(PartyRole, {
              tenantId,
              organizationId: String(entity.organizationId),
              partyId: String(entity.id),
              role,
              createdBy: auth.sub ?? null,
              createdAt: now,
              updatedAt: now,
            }),
          )
        }
        await tem.flush()
      })
    },
  },
})

export const openApi = createOrvaPartyCrudOpenApi({
  resourceName: 'Party',
  pluralName: 'Parties',
  querySchema: partyListSchema,
  listResponseSchema: createPagedListResponseSchema(partyListItemSchema),
  create: {
    schema: partyCreateSchema,
    responseSchema: createdSchema,
    description: 'Creates a neutral party (person or company), optionally with initial roles.',
  },
  update: {
    schema: partyUpdateSchema,
    responseSchema: okSchema,
    description: 'Updates party master data.',
  },
  del: {
    schema: deleteByIdSchema,
    responseSchema: okSchema,
    description: 'Soft-deletes a party.',
  },
})
