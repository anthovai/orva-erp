import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { badRequest } from '@open-mercato/shared/lib/crud/errors'
import { withTenantRls } from '@/lib/rls'
import { GlJournal, GlJournalLine } from '../../../data/entities'
import { allocateJournalNo, computeTotals, toAmount } from '../../../lib/posting'
import { journalCreateSchema, journalListSchema, journalUpdateSchema, deleteByIdSchema } from '../../../data/validators'
import { createOrvaFinanceCrudOpenApi, createPagedListResponseSchema, createdSchema, okSchema } from '../../openapi'

const ENTITY_ID = 'orva_finance:gl_journal' as const

type JournalListQuery = z.infer<typeof journalListSchema>

const journalListItemSchema = z
  .object({
    id: z.string().uuid(),
    journal_no: z.string().nullable().optional(),
    status: z.string(),
    period_id: z.string().uuid(),
    journal_date: z.string(),
    currency_code: z.string(),
    memo: z.string().nullable().optional(),
    total_debit: z.union([z.string(), z.number()]).optional(),
    total_credit: z.union([z.string(), z.number()]).optional(),
    posted_at: z.string().nullable().optional(),
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
    entity: GlJournal,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: journalListSchema,
    entityId: ENTITY_ID,
    fields: [
      'id', 'journal_no', 'status', 'journal_kind', 'period_id', 'journal_date', 'currency_code', 'memo',
      'total_debit', 'total_credit', 'posted_at', 'tenant_id', 'organization_id', 'created_at', 'updated_at',
    ],
    sortFieldMap: { id: 'id', journal_no: 'journal_no', status: 'status', journal_date: 'journal_date', created_at: 'created_at' },
    buildFilters: async (query: JournalListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.status) filters.status = query.status
      if (query.periodId) filters.period_id = query.periodId
      if (query.search) filters.journal_no = { $ilike: `%${query.search}%` }
      return filters
    },
  },
  create: {
    schema: journalCreateSchema,
    mapToEntity: (input, ctx) => ({
      status: 'draft',
      periodId: input.periodId,
      journalDate: input.journalDate,
      currencyCode: input.currencyCode ?? 'THB',
      memo: input.memo ?? null,
      createdBy: ctx.auth?.sub ?? null,
    }),
    response: (entity) => ({ id: String(entity.id) }),
  },
  update: {
    schema: journalUpdateSchema,
    getId: (input) => input.id,
    applyToEntity: (entity, input) => {
      // The DB trigger is the backstop; failing early gives a clean 400.
      if (entity.status === 'posted') throw badRequest('Posted journals are immutable')
      if (input.journalDate !== undefined) entity.journalDate = input.journalDate
      if (input.periodId !== undefined) entity.periodId = input.periodId
      if (input.memo !== undefined) entity.memo = input.memo
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
      const journal = await em.findOne(GlJournal, { id })
      if (journal?.status === 'posted') throw badRequest('Posted journals cannot be deleted')
    },
    // Lines + journal number are written inside a withTenantRls transaction:
    // the database enforces the tenant boundary and the sequence upsert is
    // race-safe under the row lock the upsert takes.
    afterCreate: async (entity, ctx) => {
      const auth = ctx.auth
      const tenantId = auth?.tenantId
      if (!auth || !tenantId) return
      const input = ctx.input
      const em = ctx.container.resolve<EntityManager>('em')
      await withTenantRls(em, tenantId, async (tem) => {
        const journalNo = await allocateJournalNo(tem, tenantId, String(entity.organizationId))
        const managed = await tem.findOne(GlJournal, { id: entity.id })
        if (!managed) throw new Error('[internal] journal disappeared during create')
        const now = new Date()
        const lines = input.lines.map((line, index) =>
          tem.create(GlJournalLine, {
            tenantId,
            organizationId: String(entity.organizationId),
            journalId: String(entity.id),
            lineNo: index + 1,
            accountId: line.accountId,
            partyId: line.partyId ?? null,
            debit: toAmount(line.debit),
            credit: toAmount(line.credit),
            description: line.description ?? null,
            createdAt: now,
            updatedAt: now,
          }),
        )
        const totals = computeTotals(input.lines)
        managed.journalNo = journalNo
        managed.totalDebit = totals.totalDebit
        managed.totalCredit = totals.totalCredit
        lines.forEach((line) => tem.persist(line))
        await tem.flush()
      })
    },
  },
})

export const openApi = createOrvaFinanceCrudOpenApi({
  resourceName: 'GL Journal',
  pluralName: 'GL Journals',
  querySchema: journalListSchema,
  listResponseSchema: createPagedListResponseSchema(journalListItemSchema),
  create: {
    schema: journalCreateSchema,
    responseSchema: createdSchema,
    description: 'Creates a draft double-entry journal with its lines; a journal number is allocated atomically.',
  },
  update: {
    schema: journalUpdateSchema,
    responseSchema: okSchema,
    description: 'Updates a DRAFT journal header. Posted journals are immutable.',
  },
  del: {
    schema: deleteByIdSchema,
    responseSchema: okSchema,
    description: 'Soft-deletes a DRAFT journal. Posted journals cannot be deleted.',
  },
})
