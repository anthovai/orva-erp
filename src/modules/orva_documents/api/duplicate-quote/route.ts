import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { buildQuoteCopy } from '../../lib/duplicateQuote'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['sales.quotes.manage'] },
}

const bodySchema = z.object({ quoteId: z.string().uuid() })
const responseSchema = z.object({ id: z.string(), quoteNumber: z.string().nullable(), lines: z.number() })

/**
 * Makes a new draft quote from an existing one.
 *
 * The copy is created through upstream's own `POST /api/sales/quotes` rather
 * than by writing rows here: that is where the line arithmetic, the custom
 * fields and — through this module's command interceptor — the next number in
 * the brand's series all happen. Duplicating those here would be a second
 * implementation of the quote, and the numbers would eventually disagree.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = bodySchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'quoteId is required' }, { status: 400 })
  const scope = { tenantId: auth.tenantId, organizationId }

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const copy = await withTenantRls(em, scope.tenantId, (tem) => buildQuoteCopy(tem, scope, parsed.data.quoteId))
  if (!copy) return Response.json({ error: 'Quote not found' }, { status: 404 })
  if (!copy.lines.length) return Response.json({ error: 'ใบเสนอราคาต้นฉบับไม่มีรายการให้คัดลอก' }, { status: 422 })

  const origin = new URL(req.url).origin
  const created = await fetch(new URL('/api/sales/quotes', origin), {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: req.headers.get('cookie') ?? '' },
    body: JSON.stringify(copy),
    cache: 'no-store',
  })
  const body = (await created.json().catch(() => null)) as { id?: string; quoteNumber?: string; error?: string } | null
  if (!created.ok || !body?.id) {
    return Response.json(
      { error: body?.error ?? `สร้างใบใหม่ไม่สำเร็จ (HTTP ${created.status})` },
      { status: created.status >= 500 ? 502 : created.status },
    )
  }
  // Upstream's create response does not carry the number; the interceptor
  // claims it during the save, so read it back rather than telling the
  // operator their new quote has no number.
  const newId = String(body.id)
  const quoteNumber = body.quoteNumber ?? await withTenantRls(em, scope.tenantId, async (tem) => {
    const rows = (await tem.execute(
      `select quote_number from sales_quotes where id = ?::uuid and tenant_id = ?::uuid`,
      [newId, scope.tenantId],
    )) as Array<{ quote_number: string | null }>
    return rows[0]?.quote_number ?? null
  })
  return Response.json({ id: newId, quoteNumber, lines: copy.lines.length })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Documents',
  summary: 'Duplicate a quote',
  methods: {
    POST: {
      summary: 'Create a new draft quote carrying the customer, currency and lines of an existing one',
      tags: ['Orva Documents'],
      requestBody: { schema: bodySchema },
      responses: [{ status: 200, description: 'The new draft.', schema: responseSchema }],
      errors: [
        { status: 404, description: 'Quote not found in this scope', schema: z.object({ error: z.string() }) },
        { status: 422, description: 'The source quote has no lines', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
