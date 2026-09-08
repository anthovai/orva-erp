import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { PurchaseOrder, PurchaseOrderLine } from '../../data/entities'
import {
  deleteByIdSchema,
  orderCreateSchema,
  orderListSchema,
  orderUpdateSchema,
} from '../../data/validators'
import {
  applyTotals,
  assertVendorRole,
  assertVersion,
  fail,
  findOrder,
  orderEvent,
  replaceLines,
} from '../../lib/orders'
import { emitPurchasingEvent } from '../../events'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_purchasing.view'] },
  POST: { requireAuth: true, requireFeatures: ['orva_purchasing.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['orva_purchasing.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['orva_purchasing.manage'] },
}

const orderRowSchema = z.object({
  id: z.string(),
  poNumber: z.string().nullable(),
  status: z.string(),
  vendorPartyId: z.string(),
  vendorName: z.string(),
  orderDate: z.string(),
  expectedOn: z.string().nullable(),
  subtotal: z.string(),
  taxAmount: z.string(),
  totalAmount: z.string(),
  memo: z.string().nullable(),
  vendorReference: z.string().nullable(),
  lineCount: z.number(),
  lateCount: z.number(),
  updatedAt: z.string(),
})

const listResponseSchema = z.object({
  items: z.array(orderRowSchema),
  total: z.number(),
  counts: z.object({ draft: z.number(), sent: z.number(), late: z.number(), committed: z.string() }),
})

type Row = {
  id: string
  po_number: string | null
  status: string
  vendor_party_id: string
  vendor_name: string
  order_date: string
  expected_on: string | null
  subtotal: string
  tax_amount: string
  total_amount: string
  memo: string | null
  vendor_reference: string | null
  line_count: number
  late_count: number
  updated_at: string
}

const toJson = (row: Row) => ({
  id: row.id,
  poNumber: row.po_number,
  status: row.status,
  vendorPartyId: row.vendor_party_id,
  vendorName: row.vendor_name,
  orderDate: row.order_date,
  expectedOn: row.expected_on,
  subtotal: row.subtotal,
  taxAmount: row.tax_amount,
  totalAmount: row.total_amount,
  memo: row.memo,
  vendorReference: row.vendor_reference,
  lineCount: Number(row.line_count),
  lateCount: Number(row.late_count),
  updatedAt: row.updated_at,
})

/**
 * The order list.
 *
 * Hand-written rather than `makeCrudRoute` for the same reason the ticket and
 * task lists are: the columns that make the list worth reading — how many
 * lines are late, and (from phase A2) how much has arrived — are aggregates
 * over a child table, which the CRUD factory's field list cannot express.
 * The response still feeds a `DataTable`, and the surrounding contracts
 * (per-method features, Zod query, tenant scope, OpenAPI) are unchanged.
 *
 * A line counts as late when its expected date has passed while the order is
 * still open. Until phase A2 there are no receipts, so "open" is the closest
 * the data can get to "not yet arrived"; A2 subtracts what was received.
 */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = orderListSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query', issues: parsed.error.issues }, { status: 400 })
  const query = parsed.data
  const tenantId = auth.tenantId
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const like = query.search ? `%${escapeLikePattern(query.search)}%` : null

  const payload = await withTenantRls(em, tenantId, async (tem) => {
    const rows = (await tem.execute(
      `select o.id, o.po_number, o.status, o.vendor_party_id,
              coalesce(p.display_name, '—') as vendor_name,
              to_char(o.order_date, 'YYYY-MM-DD') as order_date,
              to_char(o.expected_on, 'YYYY-MM-DD') as expected_on,
              o.subtotal::text as subtotal, o.tax_amount::text as tax_amount, o.total_amount::text as total_amount,
              o.memo, o.vendor_reference, o.updated_at::text as updated_at,
              coalesce(l.line_count, 0)::int as line_count,
              case when o.status in ('sent', 'partially_received') then coalesce(l.late_count, 0)::int else 0 end as late_count
         from orva_purchasing_orders o
         left join orva_parties p on p.id = o.vendor_party_id and p.deleted_at is null
         left join (
           select order_id,
                  count(*) as line_count,
                  count(*) filter (where expected_on is not null and expected_on < current_date) as late_count
             from orva_purchasing_order_lines
            where deleted_at is null
            group by order_id
         ) l on l.order_id = o.id
        where o.deleted_at is null and o.tenant_id = ?::uuid and o.organization_id = ?::uuid
          and (?::boolean is false or o.status not in ('closed', 'cancelled'))
          and (?::text is null or o.status = ?::text)
          and (?::uuid is null or o.vendor_party_id = ?::uuid)
          and (?::text is null
               or coalesce(o.po_number, '') ilike ?::text
               or coalesce(p.display_name, '') ilike ?::text
               or coalesce(o.memo, '') ilike ?::text
               or coalesce(o.vendor_reference, '') ilike ?::text)
        order by case when o.status = 'draft' then 0 else 1 end, o.order_date desc, o.created_at desc
        limit 300`,
      [
        tenantId, organizationId,
        query.bucket === 'open',
        query.status ?? null, query.status ?? null,
        query.vendorPartyId ?? null, query.vendorPartyId ?? null,
        like, like, like, like, like,
      ],
    )) as Row[]
    const [committed] = (await tem.execute(
      `select coalesce(sum(o.subtotal), 0)::text as committed
         from orva_purchasing_orders o
        where o.deleted_at is null and o.tenant_id = ?::uuid and o.organization_id = ?::uuid
          and o.status in ('sent', 'partially_received', 'received')`,
      [tenantId, organizationId],
    )) as Array<{ committed: string }>
    return { rows, committed: committed?.committed ?? '0' }
  })

  const all = payload.rows.map(toJson)
  const items = query.late === '1' ? all.filter((row) => row.lateCount > 0) : all
  return Response.json({
    items,
    total: items.length,
    counts: {
      draft: all.filter((row) => row.status === 'draft').length,
      sent: all.filter((row) => row.status === 'sent' || row.status === 'partially_received').length,
      late: all.filter((row) => row.lateCount > 0).length,
      committed: payload.committed,
    },
  })
}

/** Drafts an order. No number is claimed until it is sent. */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.sub) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = orderCreateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const input = parsed.data
  const scope = { tenantId: auth.tenantId, organizationId }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const created = await withTenantRls(em, scope.tenantId, async (tem) => {
      await assertVendorRole(tem, scope, input.vendorPartyId)
      const now = new Date()
      const order = tem.create(PurchaseOrder, {
        tenantId: scope.tenantId,
        organizationId,
        poNumber: null,
        status: 'draft',
        vendorPartyId: input.vendorPartyId,
        vendorSnapshot: null,
        orderDate: input.orderDate,
        expectedOn: input.expectedOn ?? null,
        currencyCode: 'THB',
        subtotal: '0',
        taxAmount: '0',
        totalAmount: '0',
        memo: input.memo ?? null,
        vendorReference: input.vendorReference ?? null,
        createdBy: auth.sub,
        createdAt: now,
        updatedAt: now,
      })
      tem.persist(order)
      // The primary key is generated by the database, so the parent must be
      // flushed before children can carry its id (see .ai/lessons.md).
      await tem.flush()
      await replaceLines(tem, scope, order, input.lines, now)
      await tem.flush()
      return order
    })
    await emitPurchasingEvent('orva_purchasing.order.created', orderEvent(created))
    return Response.json({ ok: true, id: created.id }, { status: 201 })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json(
      { error: error instanceof Error ? error.message : 'Create failed', code: (error as { code?: string }).code },
      { status },
    )
  }
}

/**
 * Edits an order.
 *
 * A draft is fully editable. Once sent, only the three fields that do not
 * change what the vendor was promised are: the expected date, the memo and
 * the vendor's own reference. Everything else answers 409 rather than
 * quietly rewriting a commitment already in somebody's inbox — a quantity
 * that has to rise goes through the line adjust route, which records why.
 */
export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = orderUpdateSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const input = parsed.data
  const scope = { tenantId: auth.tenantId, organizationId }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const saved = await withTenantRls(em, scope.tenantId, async (tem) => {
      const order = await findOrder(tem, scope, input.id)
      assertVersion(order, input.updatedAt)
      const now = new Date()
      const frozen = order.status !== 'draft'

      if (frozen) {
        if (input.lines || input.vendorPartyId || input.orderDate) {
          throw fail(409, 'ใบสั่งซื้อส่งให้ผู้ขายแล้ว — แก้รายการหรือผู้ขายไม่ได้ ต้องยกเลิกแล้วออกใบใหม่', 'frozen')
        }
        if (order.status === 'closed' || order.status === 'cancelled') {
          throw fail(409, 'ใบสั่งซื้อปิดแล้ว', 'closed')
        }
      } else {
        if (input.vendorPartyId && input.vendorPartyId !== order.vendorPartyId) {
          await assertVendorRole(tem, scope, input.vendorPartyId)
          order.vendorPartyId = input.vendorPartyId
        }
        if (input.orderDate) order.orderDate = input.orderDate
      }

      if (input.expectedOn !== undefined) order.expectedOn = input.expectedOn
      if (input.memo !== undefined) order.memo = input.memo
      if (input.vendorReference !== undefined) order.vendorReference = input.vendorReference

      if (input.lines) {
        await replaceLines(tem, scope, order, input.lines, now)
      } else if (!frozen) {
        // The header's expected date is the default for lines that have none;
        // recompute nothing, but keep totals honest if a line list was sent
        // earlier in this same request cycle.
        const lines = await tem.find(PurchaseOrderLine, { orderId: order.id, tenantId: scope.tenantId, deletedAt: null })
        applyTotals(
          order,
          lines.map((line) => ({ quantity: Number(line.quantity), unitPrice: Number(line.unitPrice), vatMode: line.vatMode })),
        )
      }
      order.updatedAt = now
      await tem.flush()
      return order
    })
    await emitPurchasingEvent('orva_purchasing.order.updated', orderEvent(saved))
    return Response.json({ ok: true, id: saved.id, updatedAt: saved.updatedAt.toISOString() })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json(
      { error: error instanceof Error ? error.message : 'Update failed', code: (error as { code?: string }).code },
      { status },
    )
  }
}

/** Deletes a draft. A sent order is cancelled or closed, never deleted. */
export async function DELETE(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = deleteByIdSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid id' }, { status: 400 })
  const scope = { tenantId: auth.tenantId, organizationId }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const deleted = await withTenantRls(em, scope.tenantId, async (tem) => {
      const order = await findOrder(tem, scope, parsed.data.id)
      if (order.status !== 'draft') {
        throw fail(409, 'ลบได้เฉพาะฉบับร่าง — ใบที่ส่งแล้วให้ยกเลิกหรือปิด', 'not_draft')
      }
      const now = new Date()
      const lines = await tem.find(PurchaseOrderLine, { orderId: order.id, tenantId: scope.tenantId, deletedAt: null })
      for (const line of lines) {
        line.deletedAt = now
        line.updatedAt = now
      }
      order.deletedAt = now
      order.updatedAt = now
      await tem.flush()
      return order
    })
    await emitPurchasingEvent('orva_purchasing.order.deleted', orderEvent(deleted))
    return Response.json({ ok: true })
  } catch (error: unknown) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json(
      { error: error instanceof Error ? error.message : 'Delete failed', code: (error as { code?: string }).code },
      { status },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Purchasing',
  summary: 'Purchase orders',
  methods: {
    GET: {
      summary: 'List purchase orders with late-line counts and the committed total',
      tags: ['Orva Purchasing'],
      query: orderListSchema,
      responses: [{ status: 200, description: 'Orders.', schema: listResponseSchema }],
    },
    POST: {
      summary: 'Draft a purchase order (no number is claimed until it is sent)',
      tags: ['Orva Purchasing'],
      requestBody: { schema: orderCreateSchema },
      responses: [{ status: 201, description: 'Created.', schema: z.object({ ok: z.literal(true), id: z.string() }) }],
      errors: [{ status: 400, description: 'Invalid payload, or the party holds no vendor role', schema: z.object({ error: z.string() }) }],
    },
    PUT: {
      summary: 'Edit an order — a draft fully, a sent order only its expected date, memo and vendor reference',
      tags: ['Orva Purchasing'],
      requestBody: { schema: orderUpdateSchema },
      responses: [{ status: 200, description: 'Saved.', schema: z.object({ ok: z.literal(true), id: z.string(), updatedAt: z.string() }) }],
      errors: [{ status: 409, description: 'Stale version, or the order is frozen', schema: z.object({ error: z.string(), code: z.string().optional() }) }],
    },
    DELETE: {
      summary: 'Delete a draft order',
      tags: ['Orva Purchasing'],
      query: deleteByIdSchema,
      responses: [{ status: 200, description: 'Deleted.', schema: z.object({ ok: z.literal(true) }) }],
      errors: [{ status: 409, description: 'Not a draft', schema: z.object({ error: z.string(), code: z.string().optional() }) }],
    },
  },
}
