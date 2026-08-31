import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { BrowserUnavailableError, pdfFileName, renderDocumentPdf } from '../../../../lib/pdf'
import { readCookie } from '../../../../lib/request'

const logger = createLogger('orva_documents').child({ component: 'public-pdf' })

export const metadata = {
  GET: { requireAuth: false },
}

const paramsSchema = z.object({ token: z.string().uuid() })

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

  // Resolve the heading through the public endpoint so the file name can never
  // disagree with the sheet, and so an unknown token 404s before a browser is
  // ever launched.
  const lookup = await fetch(new URL(`/api/orva_documents/public/${token}`, url.origin))
  if (!lookup.ok) return Response.json({ error: 'Not found' }, { status: 404 })
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
        {
          status: 503,
          description: 'No Chromium available for rendering',
          schema: z.object({ error: z.string(), code: z.string() }),
        },
      ],
    },
  },
}
