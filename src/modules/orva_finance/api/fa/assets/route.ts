import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { badRequest } from '@open-mercato/shared/lib/crud/errors'
import { withTenantRls } from '@/lib/rls'
import { FixedAsset, GlAccount } from '../../../data/entities'
import { assetCreateSchema, assetListSchema, assetUpdateSchema, deleteByIdSchema } from '../../../data/validators'
import { createOrvaFinanceCrudOpenApi, createPagedListResponseSchema, createdSchema, okSchema } from '../../openapi'

const ENTITY_ID = 'orva_finance:fa_asset' as const

type AssetListQuery = z.infer<typeof assetListSchema>

const assetListItemSchema = z
  .object({
    id: z.string().uuid(),
    code: z.string().nullable().optional(),
    name: z.string(),
    category: z.string().nullable().optional(),
    acquired_on: z.string(),
    cost: z.union([z.string(), z.number()]),
    salvage: z.union([z.string(), z.number()]),
    useful_life_months: z.number(),
    status: z.string(),
  })
  .passthrough()

async function allocateAssetCode(tem: EntityManager, tenantId: string, organizationId: string): Promise<string> {
  const rows = (await tem.execute(
    `insert into orva_gl_sequences as s (tenant_id, organization_id, kind, next_value)
     values (?, ?, 'fa_asset', 2)
     on conflict (tenant_id, organization_id, kind)
     do update set next_value = s.next_value + 1
     returning next_value - 1 as seq`,
    [tenantId, organizationId],
  )) as Array<{ seq: string | number }>
  return `FA-${String(Number(rows[0]?.seq ?? 0)).padStart(6, '0')}`
}

/** ทะเบียนทรัพย์สินถาวร — CRUD; depreciation runs live in ../depreciate. */
export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['orva_finance.gl.view'] },
    POST: { requireAuth: true, requireFeatures: ['orva_finance.gl.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['orva_finance.gl.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['orva_finance.gl.manage'] },
  },
  orm: {
    entity: FixedAsset,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: assetListSchema,
    entityId: ENTITY_ID,
    fields: [
      'id', 'code', 'name', 'category', 'acquired_on', 'cost', 'salvage', 'useful_life_months',
      'asset_account_id', 'accum_depr_account_id', 'expense_account_id', 'status', 'disposed_on', 'notes',
      'tenant_id', 'organization_id', 'created_at', 'updated_at',
    ],
    sortFieldMap: { code: 'code', name: 'name', acquired_on: 'acquired_on', cost: 'cost', created_at: 'created_at' },
    buildFilters: async (query: AssetListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.status) filters.status = query.status
      if (query.search) filters.name = { $ilike: `%${query.search}%` }
      return filters
    },
  },
  create: {
    schema: assetCreateSchema,
    mapToEntity: (input, ctx) => ({
      name: input.name,
      category: input.category ?? null,
      acquiredOn: input.acquiredOn,
      cost: Number(input.cost).toFixed(4),
      salvage: Number(input.salvage ?? 0).toFixed(4),
      usefulLifeMonths: input.usefulLifeMonths,
      assetAccountId: input.assetAccountId,
      accumDeprAccountId: input.accumDeprAccountId,
      expenseAccountId: input.expenseAccountId,
      status: 'active',
      notes: input.notes ?? null,
      createdBy: ctx.auth?.sub ?? null,
    }),
    response: (entity) => ({ id: String(entity.id) }),
  },
  update: {
    schema: assetUpdateSchema,
    getId: (input) => input.id,
    applyToEntity: (entity, input) => {
      if (input.name !== undefined) entity.name = input.name
      if (input.category !== undefined) entity.category = input.category
      if (input.notes !== undefined) entity.notes = input.notes
      if (input.status !== undefined) entity.status = input.status
      if (input.disposedOn !== undefined) entity.disposedOn = input.disposedOn
    },
    response: () => ({ ok: true }),
  },
  del: {
    idFrom: 'body',
    softDelete: true,
    response: () => ({ ok: true }),
  },
  hooks: {
    beforeCreate: async (input, ctx) => {
      const tenantId = ctx.auth?.tenantId
      if (!tenantId) return
      if (Number(input.salvage ?? 0) > Number(input.cost)) throw badRequest('Salvage value cannot exceed cost')
      const em = ctx.container.resolve<EntityManager>('em')
      const expect = async (id: string, type: string, label: string) => {
        const acc = await em.findOne(GlAccount, { id, tenantId, deletedAt: null })
        if (!acc) throw badRequest(`${label} account not found`)
        if (acc.accountType !== type) throw badRequest(`${label} account must be of type ${type}`)
      }
      await expect(input.assetAccountId, 'asset', 'Asset')
      await expect(input.accumDeprAccountId, 'asset', 'Accumulated depreciation')
      await expect(input.expenseAccountId, 'expense', 'Depreciation expense')
    },
    afterCreate: async (entity, ctx) => {
      const tenantId = ctx.auth?.tenantId
      if (!tenantId) return
      const em = ctx.container.resolve<EntityManager>('em')
      await withTenantRls(em, tenantId, async (tem) => {
        const managed = await tem.findOne(FixedAsset, { id: entity.id })
        if (!managed) return
        managed.code = await allocateAssetCode(tem, tenantId, String(entity.organizationId))
        await tem.flush()
      })
    },
    beforeDelete: async (id, ctx) => {
      const tenantId = ctx.auth?.tenantId
      if (!tenantId) return
      const em = ctx.container.resolve<EntityManager>('em')
      const rows = (await em.execute(
        'select count(*)::int as n from orva_fa_depreciations where asset_id = ?::uuid and tenant_id = ?::uuid',
        [id, tenantId],
      )) as Array<{ n: number }>
      if ((rows[0]?.n ?? 0) > 0) throw badRequest('Asset has depreciation runs — dispose it instead of deleting')
    },
  },
})

export const openApi = createOrvaFinanceCrudOpenApi({
  resourceName: 'Fixed asset',
  querySchema: assetListSchema,
  listResponseSchema: createPagedListResponseSchema(assetListItemSchema),
  create: { schema: assetCreateSchema, responseSchema: createdSchema, description: 'Registers a fixed asset with its GL accounts for straight-line depreciation.' },
  update: { schema: assetUpdateSchema, responseSchema: okSchema, description: 'Renames, recategorises, or disposes an asset.' },
  del: { schema: deleteByIdSchema, responseSchema: okSchema, description: 'Soft-deletes an asset that has never been depreciated.' },
})
