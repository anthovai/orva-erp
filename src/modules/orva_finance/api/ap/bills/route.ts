import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { badRequest } from '@open-mercato/shared/lib/crud/errors'
import { withTenantRls } from '@/lib/rls'
import { Party, PartyRole } from '@/modules/orva_party/data/entities'
import { ApBill, ApBillLine } from '../../../data/entities'
import { computeBillGross } from '../../../lib/ap'
import { billCreateSchema, billListSchema, billUpdateSchema, deleteByIdSchema } from '../../../data/validators'
import { createOrvaFinanceCrudOpenApi, createPagedListResponseSchema, createdSchema, okSchema } from '../../openapi'

const ENTITY_ID = 'orva_finance:ap_bill' as const

type BillListQuery = z.infer<typeof billListSchema>

const billListItemSchema = z
  .object({
    id: z.string().uuid(),
    bill_no: z.string().nullable().optional(),
    status: z.string(),
    vendor_party_id: z.string().uuid(),
    vendor_bill_ref: z.string().nullable().optional(),
    period_id: z.string().uuid(),
    bill_date: z.string(),
    due_date: z.string().nullable().optional(),
    currency_code: z.string(),
    total_amount: z.union([z.string(), z.number()]).optional(),
    journal_id: z.string().uuid().nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
  })
  .passthrough()

async function allocateBillNo(tem: EntityManager, tenantId: string, organizationId: string): Promise<string> {
  const rows = (await tem.execute(
    `insert into orva_gl_sequences as s (tenant_id, organization_id, kind, next_value)
     values (?, ?, 'ap_bill', 2)
     on conflict (tenant_id, organization_id, kind)
     do update set next_value = s.next_value + 1
     returning next_value - 1 as seq`,
    [tenantId, organizationId],
  )) as Array<{ seq: string | number }>
  const seq = Number(rows[0]?.seq ?? 0)
  if (!seq) throw new Error('orva_ap: bill number allocation failed')
  return `BILL-${String(seq).padStart(6, '0')}`
}

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['orva_finance.ap.view'] },
    POST: { requireAuth: true, requireFeatures: ['orva_finance.ap.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['orva_finance.ap.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['orva_finance.ap.manage'] },
  },
  orm: {
    entity: ApBill,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: billListSchema,
    entityId: ENTITY_ID,
    fields: [
      'id', 'bill_no', 'status', 'vendor_party_id', 'vendor_bill_ref', 'period_id', 'bill_date', 'due_date',
      'currency_code', 'memo', 'total_amount', 'paid_amount', 'journal_id', 'posted_at', 'tenant_id', 'organization_id',
      'created_at', 'updated_at',
    ],
    sortFieldMap: { id: 'id', bill_no: 'bill_no', status: 'status', bill_date: 'bill_date', due_date: 'due_date', created_at: 'created_at' },
    buildFilters: async (query: BillListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.status) filters.status = query.status
      if (query.vendorPartyId) filters.vendor_party_id = query.vendorPartyId
      if (query.search) filters.bill_no = { $ilike: `%${query.search}%` }
      return filters
    },
  },
  create: {
    schema: billCreateSchema,
    mapToEntity: (input, ctx) => ({
      status: 'draft',
      vendorPartyId: input.vendorPartyId,
      vendorBillRef: input.vendorBillRef ?? null,
      periodId: input.periodId,
      billDate: input.billDate,
      dueDate: input.dueDate ?? null,
      currencyCode: input.currencyCode ?? 'THB',
      memo: input.memo ?? null,
      taxAmount: Number(input.taxAmount ?? 0).toFixed(4),
      createdBy: ctx.auth?.sub ?? null,
    }),
    response: (entity) => ({ id: String(entity.id) }),
  },
  update: {
    schema: billUpdateSchema,
    getId: (input) => input.id,
    applyToEntity: (entity, input) => {
      if (entity.status === 'posted') throw badRequest('Posted bills are immutable')
      if (input.vendorBillRef !== undefined) entity.vendorBillRef = input.vendorBillRef
      if (input.billDate !== undefined) entity.billDate = input.billDate
      if (input.dueDate !== undefined) entity.dueDate = input.dueDate
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
    // The vendor must be a party holding an active 'vendor' role — this is
    // where orva_party pays off: one identity, role-gated per subsystem.
    beforeCreate: async (input, ctx) => {
      const tenantId = ctx.auth?.tenantId
      if (!tenantId) return
      const em = ctx.container.resolve<EntityManager>('em')
      const party = await em.findOne(Party, { id: input.vendorPartyId, tenantId, deletedAt: null })
      if (!party) throw badRequest('Vendor party not found')
      const vendorRole = await em.findOne(PartyRole, {
        partyId: input.vendorPartyId,
        role: 'vendor',
        tenantId,
        deletedAt: null,
      })
      if (!vendorRole) throw badRequest('Party does not hold the vendor role')
    },
    beforeDelete: async (id, ctx) => {
      const em = ctx.container.resolve<EntityManager>('em')
      const bill = await em.findOne(ApBill, { id })
      if (bill?.status === 'posted') throw badRequest('Posted bills cannot be deleted')
    },
    afterCreate: async (entity, ctx) => {
      const auth = ctx.auth
      const tenantId = auth?.tenantId
      if (!auth || !tenantId) return
      const input = ctx.input
      const em = ctx.container.resolve<EntityManager>('em')
      await withTenantRls(em, tenantId, async (tem) => {
        const billNo = await allocateBillNo(tem, tenantId, String(entity.organizationId))
        const managed = await tem.findOne(ApBill, { id: entity.id })
        if (!managed) throw new Error('[internal] bill disappeared during create')
        const now = new Date()
        input.lines.forEach((line, index) => {
          tem.persist(
            tem.create(ApBillLine, {
              tenantId,
              organizationId: String(entity.organizationId),
              billId: String(entity.id),
              lineNo: index + 1,
              expenseAccountId: line.expenseAccountId,
              amount: Number(line.amount).toFixed(4),
              description: line.description ?? null,
              createdAt: now,
              updatedAt: now,
            }),
          )
        })
        managed.billNo = billNo
        managed.totalAmount = computeBillGross(input.lines, input.taxAmount ?? 0)
        await tem.flush()
      })
    },
  },
})

export const openApi = createOrvaFinanceCrudOpenApi({
  resourceName: 'Vendor Bill',
  pluralName: 'Vendor Bills',
  querySchema: billListSchema,
  listResponseSchema: createPagedListResponseSchema(billListItemSchema),
  create: {
    schema: billCreateSchema,
    responseSchema: createdSchema,
    description: 'Creates a draft vendor bill with expense lines. The vendor must be a party holding the vendor role.',
  },
  update: {
    schema: billUpdateSchema,
    responseSchema: okSchema,
    description: 'Updates a DRAFT bill. Posted bills are immutable.',
  },
  del: {
    schema: deleteByIdSchema,
    responseSchema: okSchema,
    description: 'Soft-deletes a DRAFT bill.',
  },
})
