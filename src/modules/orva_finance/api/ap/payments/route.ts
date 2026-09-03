import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { badRequest } from '@open-mercato/shared/lib/crud/errors'
import { withTenantRls } from '@/lib/rls'
import { ApBill, ApPayment, ApPaymentAllocation, GlAccount } from '../../../data/entities'
import { checkAllocationFits, computeAllocationsTotal } from '../../../lib/ap'
import { paymentCreateSchema, paymentListSchema, paymentUpdateSchema, deleteByIdSchema } from '../../../data/validators'
import { createOrvaFinanceCrudOpenApi, createPagedListResponseSchema, createdSchema, okSchema } from '../../openapi'

const ENTITY_ID = 'orva_finance:ap_payment' as const

type PaymentListQuery = z.infer<typeof paymentListSchema>

const paymentListItemSchema = z
  .object({
    id: z.string().uuid(),
    payment_no: z.string().nullable().optional(),
    status: z.string(),
    vendor_party_id: z.string().uuid(),
    cash_account_id: z.string().uuid(),
    period_id: z.string().uuid(),
    payment_date: z.string(),
    currency_code: z.string(),
    total_amount: z.union([z.string(), z.number()]).optional(),
    journal_id: z.string().uuid().nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
  })
  .passthrough()

async function allocatePaymentNo(tem: EntityManager, tenantId: string, organizationId: string): Promise<string> {
  const rows = (await tem.execute(
    `insert into orva_gl_sequences as s (tenant_id, organization_id, kind, next_value)
     values (?, ?, 'ap_payment', 2)
     on conflict (tenant_id, organization_id, kind)
     do update set next_value = s.next_value + 1
     returning next_value - 1 as seq`,
    [tenantId, organizationId],
  )) as Array<{ seq: string | number }>
  const seq = Number(rows[0]?.seq ?? 0)
  if (!seq) throw new Error('orva_ap: payment number allocation failed')
  return `PAY-${String(seq).padStart(6, '0')}`
}

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['orva_finance.ap.view'] },
    POST: { requireAuth: true, requireFeatures: ['orva_finance.ap.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['orva_finance.ap.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['orva_finance.ap.manage'] },
  },
  orm: {
    entity: ApPayment,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: paymentListSchema,
    entityId: ENTITY_ID,
    fields: [
      'id', 'payment_no', 'status', 'vendor_party_id', 'cash_account_id', 'period_id', 'payment_date',
      'currency_code', 'memo', 'total_amount', 'journal_id', 'posted_at', 'tenant_id', 'organization_id',
      'created_at', 'updated_at',
    ],
    sortFieldMap: { id: 'id', payment_no: 'payment_no', status: 'status', payment_date: 'payment_date', created_at: 'created_at' },
    buildFilters: async (query: PaymentListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.status) filters.status = query.status
      if (query.vendorPartyId) filters.vendor_party_id = query.vendorPartyId
      if (query.search) filters.payment_no = { $ilike: `%${query.search}%` }
      return filters
    },
  },
  create: {
    schema: paymentCreateSchema,
    mapToEntity: (input, ctx) => ({
      status: 'draft',
      vendorPartyId: input.vendorPartyId,
      cashAccountId: input.cashAccountId,
      periodId: input.periodId,
      paymentDate: input.paymentDate,
      currencyCode: input.currencyCode ?? 'THB',
      memo: input.memo ?? null,
      whtAmount: Number(input.whtAmount ?? 0).toFixed(4),
      whtRate: input.whtRate == null ? null : Number(input.whtRate).toFixed(2),
      whtType: input.whtType ?? null,
      createdBy: ctx.auth?.sub ?? null,
    }),
    response: (entity) => ({ id: String(entity.id) }),
  },
  update: {
    schema: paymentUpdateSchema,
    getId: (input) => input.id,
    applyToEntity: (entity, input) => {
      if (entity.status === 'posted') throw badRequest('Posted payments are immutable')
      if (input.paymentDate !== undefined) entity.paymentDate = input.paymentDate
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
      const billIds = input.allocations.map((a) => a.billId)
      if (new Set(billIds).size !== billIds.length) throw badRequest('Duplicate bill in allocations')
      const bills = await em.find(ApBill, { id: { $in: billIds }, tenantId, deletedAt: null })
      if (bills.length !== billIds.length) throw badRequest('One or more bills not found')
      for (const bill of bills) {
        if (bill.status !== 'posted') throw badRequest(`Bill ${bill.billNo ?? bill.id} is not posted`)
        if (bill.vendorPartyId !== input.vendorPartyId) {
          throw badRequest(`Bill ${bill.billNo ?? bill.id} belongs to a different vendor`)
        }
        const alloc = input.allocations.find((a) => a.billId === bill.id)
        const fits = checkAllocationFits(bill.totalAmount, bill.paidAmount, alloc?.amount ?? 0)
        if (!fits.ok) throw badRequest(`Bill ${bill.billNo ?? bill.id}: ${fits.reason}`)
      }
    },
    beforeDelete: async (id, ctx) => {
      const em = ctx.container.resolve<EntityManager>('em')
      const payment = await em.findOne(ApPayment, { id })
      if (payment?.status === 'posted') throw badRequest('Posted payments cannot be deleted')
    },
    afterCreate: async (entity, ctx) => {
      const auth = ctx.auth
      const tenantId = auth?.tenantId
      if (!auth || !tenantId) return
      const input = ctx.input
      const em = ctx.container.resolve<EntityManager>('em')
      await withTenantRls(em, tenantId, async (tem) => {
        const paymentNo = await allocatePaymentNo(tem, tenantId, String(entity.organizationId))
        const managed = await tem.findOne(ApPayment, { id: entity.id })
        if (!managed) throw new Error('[internal] payment disappeared during create')
        const now = new Date()
        for (const alloc of input.allocations) {
          tem.persist(
            tem.create(ApPaymentAllocation, {
              tenantId,
              organizationId: String(entity.organizationId),
              paymentId: String(entity.id),
              billId: alloc.billId,
              amount: Number(alloc.amount).toFixed(4),
              createdAt: now,
              updatedAt: now,
            }),
          )
        }
        managed.paymentNo = paymentNo
        managed.totalAmount = computeAllocationsTotal(input.allocations)
        await tem.flush()
      })
    },
  },
})

export const openApi = createOrvaFinanceCrudOpenApi({
  resourceName: 'Vendor Payment',
  pluralName: 'Vendor Payments',
  querySchema: paymentListSchema,
  listResponseSchema: createPagedListResponseSchema(paymentListItemSchema),
  create: {
    schema: paymentCreateSchema,
    responseSchema: createdSchema,
    description: 'Creates a draft vendor payment allocated against posted bills of the same vendor.',
  },
  update: {
    schema: paymentUpdateSchema,
    responseSchema: okSchema,
    description: 'Updates a DRAFT payment. Posted payments are immutable.',
  },
  del: {
    schema: deleteByIdSchema,
    responseSchema: okSchema,
    description: 'Soft-deletes a DRAFT payment.',
  },
})
