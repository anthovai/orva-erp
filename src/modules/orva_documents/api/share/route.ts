import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import {
  resolveActiveOrganizationId,
  organizationScopeRequiredResponse,
} from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesQuote } from '@open-mercato/core/modules/sales/data/entities'
import { hashAuthToken } from '@open-mercato/core/modules/auth/lib/tokenHash'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { shareSchema } from '../../data/validators'

const logger = createLogger('orva_documents').child({ component: 'share' })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['sales.quotes.manage'] },
}

const responseSchema = z.object({
  url: z.string(),
  validUntil: z.string().nullable(),
})

/**
 * Mints the customer link for a quotation — the "คัดลอกลิงก์ลูกค้า" button.
 *
 * The link's credential is the SAME acceptance token the sales module emails
 * (one door, not a second one — the public routes resolve only this token).
 * Tokens are stored hashed, so the plaintext of an earlier link cannot be
 * recovered: every call ROTATES the token, and any previously shared link
 * stops working. The UI says so.
 *
 * Mirrors sales' quotes/send persistence (minus the email): the token is
 * committed before the URL is returned, so a copied link is always durably
 * stored; a draft quote becomes 'sent' — a link in a customer's hands is a
 * sent quote.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()

  const parsed = shareSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) {
    return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = (container.resolve<EntityManager>('em')).fork()

  try {
    const quote = await findOneWithDecryption(
      em, SalesQuote,
      { id: parsed.data.quoteId, deletedAt: null },
      {},
      { tenantId: auth.tenantId },
    )
    if (!quote || quote.tenantId !== auth.tenantId || quote.organizationId !== organizationId) {
      return Response.json({ error: 'Quote not found' }, { status: 404 })
    }
    if ((quote.status ?? null) === 'canceled') {
      return Response.json({ error: 'Canceled quotes cannot be shared' }, { status: 400 })
    }

    const now = new Date()
    const rawToken = crypto.randomUUID()
    await em.transactional(async (tx) => {
      quote.acceptanceToken = hashAuthToken(rawToken)
      // keep an explicit validity; without one the link would never expire
      if (!quote.validUntil) {
        const fallback = new Date(now)
        fallback.setUTCDate(fallback.getUTCDate() + 30)
        quote.validUntil = fallback
      }
      if (!quote.sentAt) quote.sentAt = now
      if ((quote.status ?? 'draft') === 'draft') quote.status = 'sent'
      quote.updatedAt = now
      tx.persist(quote)
    })

    const origin = (process.env.APP_URL || new URL(req.url).origin).replace(/\/$/, '')
    return Response.json({
      url: `${origin}/documents/${rawToken}`,
      validUntil: quote.validUntil ? quote.validUntil.toISOString().slice(0, 10) : null,
    })
  } catch (error) {
    logger.error('Share link mint failed', {
      quoteId: parsed.data.quoteId,
      err: error instanceof Error ? error.message : String(error),
    })
    return Response.json({ error: 'Could not create the customer link' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Documents',
  summary: 'Customer link for a quotation',
  methods: {
    POST: {
      summary: 'Mint (rotate) the customer link for a quotation',
      description:
        'Returns a public URL for the quotation. Rotates the acceptance token — any previously shared or emailed link stops working.',
      tags: ['Orva Documents'],
      requestBody: { schema: shareSchema },
      responses: [{ status: 200, description: 'The customer link.', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid payload or canceled quote', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Quote not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
