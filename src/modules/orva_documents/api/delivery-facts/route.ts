import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import {
  resolveActiveOrganizationId,
  organizationScopeRequiredResponse,
} from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { deliveryFactsSchema } from '../../data/validators'
import { mergeDeliveryFacts, storedDeliveryFrom } from '../../lib/deliveryFacts'

const logger = createLogger('orva_documents').child({ component: 'delivery-facts' })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_documents.view'] },
  POST: { requireAuth: true, requireFeatures: ['sales.invoices.manage'] },
}

const factsSchema = z.object({
  deliveredOn: z.string().nullable(),
  carrier: z.string().nullable(),
  trackingNumbers: z.array(z.string()),
  address: z.string().nullable(),
  note: z.string().nullable(),
  showPrices: z.boolean(),
})

const contextSchema = z.object({
  id: z.string().uuid(),
  invoiceNumber: z.string(),
  issueDate: z.string().nullable(),
  /** The delivery address the sheet would fall back to, so the dialog can offer it. */
  suggestedAddress: z.string().nullable(),
  delivery: factsSchema,
  /** Echo back with the POST as the optimistic-lock version. */
  updatedAt: z.string().nullable(),
})

const resultSchema = z.object({ id: z.string().uuid(), delivery: factsSchema, updatedAt: z.string().nullable() })

type InvoiceRow = {
  id: string
  invoice_number: string
  issue_date: string | null
  metadata: Record<string, unknown> | null
  updated_at: string | null
}

async function loadInvoice(em: EntityManager, tenantId: string, invoiceId: string): Promise<InvoiceRow | null> {
  const rows = (await em.execute(
    `select id, invoice_number, to_char(issue_date, 'YYYY-MM-DD') as issue_date, metadata,
            to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at
     from sales_invoices
     where deleted_at is null and tenant_id = ?::uuid and id = ?::uuid`,
    [tenantId, invoiceId],
  )) as InvoiceRow[]
  return rows[0] ?? null
}

/** Address text out of a sales address snapshot, matching `lib/source.ts`. */
function addressText(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const snapshot = value as Record<string, unknown>
  const parts = ['addressLine1', 'addressLine2', 'city', 'region', 'postalCode']
    .map((key) => (typeof snapshot[key] === 'string' ? (snapshot[key] as string).trim() : ''))
    .filter(Boolean)
  return parts.length ? parts.join(' ') : null
}

/** What the dialog needs before recording: the facts so far, and the version. */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const invoiceId = url.searchParams.get('invoiceId')
  if (!invoiceId || !/^[0-9a-f-]{36}$/i.test(invoiceId)) {
    return Response.json({ error: 'invoiceId is required' }, { status: 400 })
  }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const row = await loadInvoice(em.fork(), auth.tenantId, invoiceId)
  if (!row) return Response.json({ error: 'Invoice not found' }, { status: 404 })
  const meta = (row.metadata ?? {}) as Record<string, unknown>
  return Response.json({
    id: row.id,
    invoiceNumber: row.invoice_number,
    issueDate: row.issue_date ?? null,
    suggestedAddress: addressText(meta.shippingAddressSnapshot) ?? addressText(meta.billingAddressSnapshot),
    delivery: storedDeliveryFrom(meta.delivery, {}),
    updatedAt: row.updated_at ?? null,
  })
}

/**
 * Records what happened to a delivery, so the ใบส่งของ prints it and the
 * office knows the VAT point for the goods.
 *
 * The write is a direct scoped UPDATE inside withTenantRls rather than
 * upstream's `PUT /api/sales/invoices` — the same reason `record-payment`
 * gives: that route's command diffs the payload with `buildChanges()` and
 * then assigns the audit records back onto the entity, so any partial update
 * crashes with a MikroORM ValidationError. `updated_at` doubles as the
 * optimistic lock and a stale version is a 409, per the app's rules.
 *
 * A payload carrying `receiverName` is refused rather than quietly stripped:
 * `sales_invoices.metadata` is NOT in sales' encryption map (Q-004), so a
 * third party's name would sit in plaintext at rest, and a caller who tried
 * should be told instead of believing it was saved.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()

  const raw = await readJsonSafe(req)
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'receiverName' in (raw as Record<string, unknown>)) {
    return Response.json(
      { error: 'ไม่บันทึกชื่อผู้รับสินค้า — ใบส่งของเว้นช่องให้ลงลายมือชื่อ (Q-004: invoice metadata is not encrypted at rest)' },
      { status: 400 },
    )
  }
  const parsed = deliveryFactsSchema.safeParse(raw)
  if (!parsed.success) {
    return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  }
  const { invoiceId, updatedAt, ...facts } = parsed.data

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const row = await loadInvoice(em.fork(), auth.tenantId, invoiceId)
    if (!row) return Response.json({ error: 'Invoice not found' }, { status: 404 })

    // Every other key in metadata — quoteId, the snapshots, paidDate — has to
    // survive this write; only `delivery` is replaced.
    const { metadata, delivery } = mergeDeliveryFacts(row.metadata, facts)

    const updatedRows = await withTenantRls(em, auth.tenantId, async (tem) =>
      (await tem.execute(
        `update sales_invoices
         set metadata = ?::jsonb, updated_at = date_trunc('milliseconds', now())
         where id = ?::uuid and tenant_id = ?::uuid and deleted_at is null
         -- The version is read back as an ISO string truncated to
         -- milliseconds, while now() carries microseconds: comparing the two
         -- for equality makes the SECOND write on a row always 409, because
         -- the value the caller echoes can no longer match what is stored.
         -- Truncating both sides is the fix; writing a truncated timestamp
         -- keeps the value the caller gets back exact for its next write.
           and date_trunc('milliseconds', updated_at) = ?::timestamptz
         returning to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at`,
        [JSON.stringify(metadata), invoiceId, auth.tenantId, updatedAt],
      )) as Array<{ updated_at: string }>,
    )
    if (updatedRows.length === 0) {
      // The row exists (loaded above) — the version no longer matches.
      return Response.json({ error: 'Conflict — reload and retry' }, { status: 409 })
    }

    return Response.json({ id: invoiceId, delivery, updatedAt: updatedRows[0]?.updated_at ?? null })
  } catch (error) {
    logger.error('Recording delivery facts failed', {
      invoiceId,
      err: error instanceof Error ? error.message : String(error),
    })
    return Response.json({ error: 'Could not record the delivery' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Documents',
  summary: 'Delivery facts on an issued invoice (ใบส่งของ)',
  methods: {
    GET: {
      summary: 'Delivery facts recorded so far, with the version to send back',
      tags: ['Orva Documents'],
      responses: [{ status: 200, description: 'Delivery context for one invoice.', schema: contextSchema }],
      errors: [
        { status: 400, description: 'invoiceId missing', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Invoice not found', schema: z.object({ error: z.string() }) },
      ],
    },
    POST: {
      summary: 'Record the delivery date, carrier, tracking, address and the show-prices flag',
      description:
        'Merges the facts into sales_invoices.metadata.delivery, preserving every other metadata key. A receiver name is refused: invoice metadata is not encrypted at rest, so the sheet leaves a blank signature line instead.',
      tags: ['Orva Documents'],
      requestBody: { schema: deliveryFactsSchema },
      responses: [{ status: 200, description: 'Delivery recorded.', schema: resultSchema }],
      errors: [
        { status: 400, description: 'Invalid payload, or a receiver name was supplied', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Invoice not found', schema: z.object({ error: z.string() }) },
        { status: 409, description: 'Concurrent update — reload and retry', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
