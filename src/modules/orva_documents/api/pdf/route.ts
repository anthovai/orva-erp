import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { previewQuerySchema } from '../../data/validators'
import { BrowserUnavailableError, pdfFileName, renderDocumentPdf } from '../../lib/pdf'
import { buildDocumentUrl, readCookie, resolveDocument, resolveDocumentHeading } from '../../lib/request'
import { buildEtaxXml, type EtaxDocumentType } from '../../lib/etaxXml'
import { toPdfA3 } from '../../lib/pdfA3'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_documents.view'] },
}

/**
 * Streams the document as a PDF by printing the operator's own preview
 * screen in headless Chromium (see lib/pdf.ts for why a browser and not a
 * PDF library). The caller's session cookie is handed to the browser, so the
 * PDF is scoped by exactly the same auth and tenant rules as the screen.
 */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()

  const url = new URL(req.url)
  const parsed = previewQuerySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) return Response.json({ error: 'Invalid query' }, { status: 400 })

  const authToken = readCookie(req, 'auth_token')
  if (!authToken) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // etax=1: the PDF/A-3 variant (ขมธอ.3-2560 XML embedded) — tax documents
  // from a real record only, for manual validation or filing outside email
  const wantEtax = url.searchParams.get('etax') === '1'
  const isTaxType = parsed.data.type === 'tax_invoice' || parsed.data.type === 'receipt'
  if (wantEtax && (!isTaxType || !parsed.data.documentId)) {
    return Response.json({ error: 'e-Tax PDF/A-3 applies to tax documents from a real record' }, { status: 400 })
  }

  try {
    const heading = await resolveDocumentHeading(req, parsed.data)
    let pdf = await renderDocumentPdf({
      url: buildDocumentUrl(url, parsed.data),
      authToken,
      host: url.hostname,
      locale: readCookie(req, 'locale') ?? undefined,
    })
    if (wantEtax) {
      const etaxType = parsed.data.type as EtaxDocumentType
      const fullDoc = await resolveDocument(req, parsed.data)
      pdf = await toPdfA3({
        pdf,
        xml: buildEtaxXml(fullDoc, etaxType),
        title: `${heading.headingTh} ${heading.number}`.trim(),
        documentType: etaxType === 'receipt' ? 'Receipt' : 'Tax Invoice',
      })
    }
    return new Response(pdf as BodyInit, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(pdfFileName(heading.headingTh, heading.number))}`,
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    if (error instanceof BrowserUnavailableError) {
      // An unconfigured deployment is an operator problem, not a bug — say so.
      return Response.json({ error: error.message, code: 'pdf_browser_unavailable' }, { status: 503 })
    }
    return Response.json({ error: 'Could not render the document as PDF' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Documents',
  summary: 'Document as PDF',
  methods: {
    GET: {
      summary: 'Render the document to a PDF file',
      description:
        'Prints the document preview in headless Chromium. Requires a Chromium executable on the host — set ORVA_PDF_BROWSER_PATH in production. Add etax=1 on a tax document from a real record to receive the PDF/A-3 variant with the ขมธอ.3-2560 XML embedded (ETDA-invoice.xml).',
      tags: ['Orva Documents'],
      query: previewQuerySchema,
      responses: [{ status: 200, description: 'The PDF file.', mediaType: 'application/pdf' }],
      errors: [
        { status: 400, description: 'Invalid query', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) },
        { status: 503, description: 'No Chromium available for rendering', schema: z.object({ error: z.string(), code: z.string() }) },
      ],
    },
  },
}
