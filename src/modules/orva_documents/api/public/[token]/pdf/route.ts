import { getCachedRateLimiterService } from '@open-mercato/core/bootstrap'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readEndpointRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'
import { checkRateLimit, getClientIp, rateLimitErrorSchema } from '@open-mercato/shared/lib/ratelimit/helpers'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { z } from 'zod'
import { BrowserUnavailableError, pdfFileName, renderDocumentPdf } from '../../../../lib/pdf'
import { readCookie } from '../../../../lib/request'

const logger = createLogger('orva_documents').child({ component: 'public-pdf' })

export const metadata = {
  GET: { requireAuth: false },
}

const paramsSchema = z.object({ token: z.string().uuid() })

/**
 * Every allowed request here starts a Chromium process for a few seconds, so
 * this endpoint is far more expensive than the JSON one beside it and is open
 * to anyone holding a link. Tune per deployment with
 * RATE_LIMIT_ORVA_DOCUMENT_PDF_POINTS / _DURATION / _BLOCK_DURATION.
 */
const pdfRateLimitConfig = readEndpointRateLimitConfig('ORVA_DOCUMENT_PDF', {
  points: 10,
  duration: 60,
  blockDuration: 120,
  keyPrefix: 'orva-document-pdf',
})

/**
 * Two buckets, because either one alone leaves a hole.
 *
 * The per-IP bucket is the real defence but `getClientIp` returns null unless
 * RATE_LIMIT_TRUST_PROXY_DEPTH is configured — behind an unconfigured proxy
 * an IP-only limit would silently protect nothing. The per-token bucket
 * always applies, so a leaked link cannot be hammered from a botnet either.
 *
 * Fail-closed, unlike the login-path limiters: those degrade to unlimited
 * rather than break sign-in, whereas here an unenforced limit means unbounded
 * browser processes. A customer retrying a download is the cheaper failure.
 */
async function enforcePdfRateLimit(req: Request, key: string): Promise<Response | null> {
  const rateLimiterService = getCachedRateLimiterService()
  if (!rateLimiterService) return null
  const { translate } = await resolveTranslations()
  return checkRateLimit(
    rateLimiterService,
    pdfRateLimitConfig,
    key,
    translate('api.errors.rateLimit', 'Too many requests. Please try again later.'),
    {
      failClosed: true,
      unavailableMessage: translate(
        'api.errors.rateLimitUnavailable',
        'Service temporarily unavailable. Please try again later.',
      ),
    },
  )
}

/**
 * The customer's own copy, as a file.
 *
 * Prints the same token-scoped page the customer is looking at, with no
 * session cookie attached — the URL is the entire credential, so Chromium
 * must not carry a staff session into the render.
 */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> | { token: string } }) {
  const parsed = paramsSchema.safeParse(await ctx.params)
  if (!parsed.success) return Response.json({ error: 'Not found' }, { status: 404 })
  const { token } = parsed.data

  const url = new URL(req.url)

  // Charged before the lookup so a flood of unknown tokens is cut off too.
  const clientIp = getClientIp(req, getCachedRateLimiterService()?.trustProxyDepth ?? 0)
  if (clientIp) {
    const limited = await enforcePdfRateLimit(req, `ip:${clientIp}`)
    if (limited) return limited
  }

  // Resolve the heading through the public endpoint so the file name can never
  // disagree with the sheet, and so an unknown token 404s before a browser is
  // ever launched.
  const lookup = await fetch(new URL(`/api/orva_documents/public/${token}`, url.origin))
  if (!lookup.ok) return Response.json({ error: 'Not found' }, { status: 404 })

  // Charged only for tokens that exist, so the key space stays bounded.
  const limitedByToken = await enforcePdfRateLimit(req, `doc:${token}`)
  if (limitedByToken) return limitedByToken

  const body = (await lookup.json()) as { document?: { headingTh?: string; number?: string } }

  try {
    const pdf = await renderDocumentPdf({
      url: new URL(`/documents/${token}`, url.origin).toString(),
      host: url.hostname,
      locale: readCookie(req, 'locale') ?? undefined,
    })
    const fileName = pdfFileName(body.document?.headingTh ?? 'เอกสาร', body.document?.number ?? '')
    return new Response(new Uint8Array(pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    if (error instanceof BrowserUnavailableError) {
      return Response.json({ error: error.message, code: 'pdf_browser_unavailable' }, { status: 503 })
    }
    logger.error('Public PDF render failed', { err: error instanceof Error ? error.message : String(error) })
    return Response.json({ error: 'Could not create the PDF' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Documents',
  summary: 'Customer document PDF (public)',
  pathParams: paramsSchema,
  methods: {
    GET: {
      summary: 'Download the quotation behind a customer acceptance token as a PDF',
      tags: ['Orva Documents'],
      responses: [{ status: 200, description: 'A4 PDF stream.' }],
      errors: [
        { status: 404, description: 'Unknown or revoked token', schema: z.object({ error: z.string() }) },
        { status: 429, description: 'Too many downloads for this link or client', schema: rateLimitErrorSchema },
        {
          status: 503,
          description: 'No Chromium available for rendering',
          schema: z.object({ error: z.string(), code: z.string() }),
        },
      ],
    },
  },
}
