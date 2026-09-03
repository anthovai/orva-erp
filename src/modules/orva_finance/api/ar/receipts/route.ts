import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { badRequest } from '@open-mercato/shared/lib/crud/errors'
import { withTenantRls } from '@/lib/rls'
import { ArInvoicePosting, ArReceipt, ArReceiptAllocation, GlAccount } from '../../../data/entities'
import { computeAllocationsTotal } from '../../../lib/ap'
import { receiptCreateSchema, receiptListSchema, receiptUpdateSchema, deleteByIdSchema } from '../../../data/validators'
import { createOrvaFinanceCrudOpenApi, createPagedListResponseSchema, createdSchema, okSchema } from '../../openapi'

const ENTITY_ID = 'orva_finance:ar_receipt' as const

type ReceiptListQuery = z.infer<typeof receiptListSchema>

const receiptListItemSchema = z
  .object({
    id: z.string().uuid(),
    receipt_no: z.string().nullable().optional(),
    status: z.string(),
    cash_account_id: z.string().uuid(),
    period_id: z.string().uuid(),
    receipt_date: z.string(),
    currency_code: z.string(),
    total_amount: z.union([z.string(), z.number()]).optional(),
    journal_id: z.string().uuid().nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
  })
  .passthrough()

async function allocateReceiptNo(tem: EntityManager, tenantId: string, organizationId: string): Promise<string> {
  const rows = (await tem.execute(
    `insert into orva_gl_sequences as s (tenant_id, organization_id, kind, next_value)
     values (?, ?, 'ar_receipt', 2)
     on conflict (tenant_id, organization_id, kind)
     do update set next_value = s.next_value + 1
     returning next_value - 1 as seq`,
    [tenantId, organizationId],
  )) as Array<{ seq: string | number }>
  const seq = Number(rows[0]?.seq ?? 0)
  if (!seq) throw new Error('orva_ar: receipt number allocation failed')
  return `RCT-${String(seq).padStart(6, '0')}`
}

/** posted receipt allocations already consuming an invoice's posted amount */
async function receivedSoFar(em: EntityManager, tenantId: string, invoiceId: string): Promise<number> {
  const rows = (await em.execute(
    `select coalesce(sum(a.amount), 0) as received
     from orva_ar_receipt_allocations a
     join orva_ar_receipts r on r.id = a.receipt_id and r.status = 'posted' and r.deleted_at is null
     where a.invoice_id = ?::uuid and a.tenant_id = ?::uuid and a.deleted_at is null`,
    [invoiceId, tenantId],
  )) as Array<{ received: string | number }>
  return Number(rows[0]?.received ?? 0)
}

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['orva_finance.ar.view'] },
    POST: { requireAuth: true, requireFeatures: ['orva_finance.ar.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['orva_finance.ar.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['orva_finance.ar.manage'] },
  },
  orm: {
    entity: ArReceipt,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: receiptListSchema,
    entityId: ENTITY_ID,
    fields: [
      'id', 'receipt_no', 'status', 'customer_party_id', 'cash_account_id', 'period_id', 'receipt_date',
      'currency_code', 'memo', 'total_amount', 'journal_id', 'posted_at', 'tenant_id', 'organization_id',
      'created_at', 'updated_at',
    ],
    sortFieldMap: { id: 'id', receipt_no: 'receipt_no', status: 'status', receipt_date: 'receipt_date', created_at: 'created_at' },
    buildFilters: async (query: ReceiptListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.status) filters.status = query.status
      if (query.search) filters.receipt_no = { $ilike: `%${query.search}%` }
      return filters
    },
  },
  create: {
    schema: receiptCreateSchema,
    mapToEntity: (input, ctx) => ({
      status: 'draft',
      customerPartyId: input.customerPartyId ?? null,
      cashAccountId: input.cashAccountId,
      periodId: input.periodId,
      receiptDate: input.receiptDate,
      currencyCode: input.currencyCode ?? 'THB',
      memo: input.memo ?? null,
      whtAmount: Number(input.whtAmount ?? 0).toFixed(4),
      whtRate: input.whtRate == null ? null : Number(input.whtRate).toFixed(2),
      createdBy: ctx.auth?.sub ?? null,
    }),
    response: (entity) => ({ id: String(entity.id) }),
  },
  update: {
    schema: receiptUpdateSchema,
    getId: (input) => input.id,
    applyToEntity: (entity, input) => {
      if (entity.status === 'posted') throw badRequest('Posted receipts are immutable')
      if (input.receiptDate !== undefined) entity.receiptDate = input.receiptDate
      if (input.periodId !== undefined) entity.periodId = input.periodId
      if (input.cashAccountId !== undefined) entity.cashAccountId = input.cashAccountId
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
    beforeCreate: async (input, ctx) => {
      const tenantId = ctx.auth?.tenantId
      if (!tenantId) return
      const em = ctx.container.resolve<EntityManager>('em')
      const cash = await em.findOne(GlAccount, { id: input.cashAccountId, tenantId, deletedAt: null })
      if (!cash) throw badRequest('Cash account not found')
      if (cash.accountType !== 'asset') throw badRequest('Cash account must be an asset account')
      const invoiceIds = input.allocations.map((a) => a.invoiceId)
      if (new Set(invoiceIds).size !== invoiceIds.length) throw badRequest('Duplicate invoice in allocations')
      for (const alloc of input.allocations) {
        const posting = await em.findOne(ArInvoicePosting, { invoiceId: alloc.invoiceId, tenantId })
        if (!posting) throw badRequest('Invoice is not posted to the ledger yet')
        const received = await receivedSoFar(em, tenantId, alloc.invoiceId)
        const remaining = Number(posting.amount) - received
        if (Number(alloc.amount) > remaining + 0.00005) {
          throw badRequest(`Invoice ${posting.invoiceNumber}: allocation exceeds remaining ${remaining.toFixed(4)}`)
        }
      }
    },
    beforeDelete: async (id, ctx) => {
      const em = ctx.container.resolve<EntityManager>('em')
      const receipt = await em.findOne(ArReceipt, { id })
      if (receipt?.status === 'posted') throw badRequest('Posted receipts cannot be deleted')
    },
    afterCreate: async (entity, ctx) => {
      const auth = ctx.auth
      const tenantId = auth?.tenantId
      if (!auth || !tenantId) return
      const input = ctx.input
      const em = ctx.container.resolve<EntityManager>('em')
      await withTenantRls(em, tenantId, async (tem) => {
        const receiptNo = await allocateReceiptNo(tem, tenantId, String(entity.organizationId))
        const managed = await tem.findOne(ArReceipt, { id: entity.id })
        if (!managed) throw new Error('[internal] receipt disappeared during create')
        const now = new Date()
        for (const alloc of input.allocations) {
          tem.persist(
            tem.create(ArReceiptAllocation, {
              tenantId,
              organizationId: String(entity.organizationId),
              receiptId: String(entity.id),
              invoiceId: alloc.invoiceId,
              amount: Number(alloc.amount).toFixed(4),
              createdAt: now,
              updatedAt: now,
            }),
          )
        }
        managed.receiptNo = receiptNo
        managed.totalAmount = computeAllocationsTotal(
          input.allocations.map((a) => ({ billId: a.invoiceId, amount: a.amount })),
        )
        await tem.flush()
      })
    },
  },
})

export const openApi = createOrvaFinanceCrudOpenApi({
  resourceName: 'Customer Receipt',
  pluralName: 'Customer Receipts',
  querySchema: receiptListSchema,
  listResponseSchema: createPagedListResponseSchema(receiptListItemSchema),
  create: {
    schema: receiptCreateSchema,
    responseSchema: createdSchema,
    description: 'Creates a draft customer receipt allocated against GL-posted sales invoices.',
  },
  update: {
    schema: receiptUpdateSchema,
    responseSchema: okSchema,
    description: 'Updates a DRAFT receipt. Posted receipts are immutable.',
  },
  del: {
    schema: deleteByIdSchema,
    responseSchema: okSchema,
    description: 'Soft-deletes a DRAFT receipt.',
  },
})
