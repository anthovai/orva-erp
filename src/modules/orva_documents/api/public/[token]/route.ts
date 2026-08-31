import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { loadDictionary } from '@open-mercato/shared/lib/i18n/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { isForeignTenantActor } from '@open-mercato/core/modules/sales/lib/publicQuoteTenantScope'
import { hashAuthToken } from '@open-mercato/core/modules/auth/lib/tokenHash'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { documentFromQuote, findQuoteByHashedToken, loadSettings } from '../../../lib/source'

const logger = createLogger('orva_documents').child({ component: 'public' })

export const metadata = {
  GET: { requireAuth: false },
}

const paramsSchema = z.object({ token: z.string().uuid() })

const responseSchema = z.object({
  document: z.record(z.string(), z.unknown()),
  labels: z.record(z.string(), z.string()),
  isExpired: z.boolean(),
})

/**
 * The labels printed on the sheet travel with the document, pinned to Thai.
 *
 * They are not UI chrome: "เลขประจำตัวผู้เสียภาษี" and "จำนวนเงินรวมทั้งสิ้น"
 * are what makes the paper a Thai statutory document. Letting them follow the
 * recipient's Accept-Language would mean the seller approves one sheet and the
 * customer prints another — and an English-labelled ใบกำกับภาษี is not a valid
 * one. A per-tenant document language, if it is ever wanted, belongs in
 * document settings rather than in the visitor's browser.
 */
async function documentLabels(): Promise<Record<string, string>> {
  const dictionary = await loadDictionary('th')
  return Object.fromEntries(
    Object.entries(dictionary).filter(([key]) => key.startsWith('orva_documents.')),
  ) as Record<string, string>
}

/**
 * The document behind a customer's quote link.
 *
 * The acceptance token the sales module already emails is the only credential
 * — the same door, not a second one, so this endpoint deliberately mirrors
 * the sales public route's guards: hashed-token lookup, and a signed-in actor
 * from another tenant is treated as if the link did not exist.
 *
 * Only ใบเสนอราคา is served here. The token authorises a quotation; issuing a
 * ใบกำกับภาษี off the same link would be putting a statutory tax document in
 * a customer's hands for a sale that has not happened.
 */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> | { token: string } }) {
  const parsed = paramsSchema.safeParse(await ctx.params)
  if (!parsed.success) return Response.json({ error: 'Not found' }, { status: 404 })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    // No tenant is known until the token resolves, so this first read runs on
    // the framework path where the RLS policies are fail-open; every read
    // after it is pinned to the quote's own tenant.
    const row = await findQuoteByHashedToken(em, hashAuthToken(parsed.data.token))
    if (!row) return Response.json({ error: 'Not found' }, { status: 404 })

    const auth = await getAuthFromRequest(req)
    if (isForeignTenantActor(auth, row.tenant_id)) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    const tenantId = String(row.tenant_id)
    const organizationId = row.organization_id ? String(row.organization_id) : null

    const document = await withTenantRls(em, tenantId, async (tem) => {
      const settings = await loadSettings(tem, { tenantId, organizationId })
      return documentFromQuote(tem, { row, type: 'quotation', settings })
    })

    const validUntil = document.secondaryDate ? new Date(`${document.secondaryDate}T23:59:59Z`) : null
    const isExpired = !!validUntil && validUntil.getTime() < Date.now()

    return Response.json({ document, labels: await documentLabels(), isExpired })
  } catch (error) {
    logger.error('Public document build failed', {
      err: error instanceof Error ? error.message : String(error),
    })
    return Response.json({ error: 'Could not build the document' }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Documents',
  summary: 'Customer document (public)',
  pathParams: paramsSchema,
  methods: {
    GET: {
      summary: 'Render the quotation behind a customer acceptance token',
      description:
        'Public, authenticated by the acceptance token alone. Serves ใบเสนอราคา only; a session from another tenant is answered with 404, matching the sales public quote route.',
      tags: ['Orva Documents'],
      responses: [{ status: 200, description: 'The printable document.', schema: responseSchema }],
      errors: [{ status: 404, description: 'Unknown or revoked token', schema: z.object({ error: z.string() }) }],
    },
  },
}
