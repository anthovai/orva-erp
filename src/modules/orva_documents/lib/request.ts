import type { DocumentType, PrintableDocument, TemplateId } from './document'

/** Reads one cookie off an incoming request. */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie') ?? ''
  for (const part of header.split(';')) {
    const [cookieName, ...rest] = part.trim().split('=')
    if (cookieName === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

export type DocumentSelector = {
  type: DocumentType
  template?: TemplateId
  documentId?: string
}

/**
 * The preview screen URL for a selection — the same address the operator
 * would open, which is what the PDF renderer prints.
 */
export function buildDocumentUrl(requestUrl: URL, selector: DocumentSelector): string {
  const target = new URL('/backend/documents/preview', requestUrl.origin)
  target.searchParams.set('type', selector.type)
  if (selector.template) target.searchParams.set('template', selector.template)
  if (selector.documentId) target.searchParams.set('documentId', selector.documentId)
  return target.toString()
}

/**
 * Heading and number for the file name / email subject. Reuses the preview
 * endpoint over HTTP with the caller's cookies rather than duplicating the
 * build logic, so the naming can never disagree with the sheet.
 */
/** Full presentation model for a selection — the e-Tax XML builds from it. */
export async function resolveDocument(
  req: Request,
  selector: DocumentSelector,
): Promise<PrintableDocument> {
  const url = new URL(req.url)
  const target = new URL('/api/orva_documents/preview', url.origin)
  target.searchParams.set('type', selector.type)
  if (selector.template) target.searchParams.set('template', selector.template)
  if (selector.documentId) target.searchParams.set('documentId', selector.documentId)
  const res = await fetch(target, { headers: { cookie: req.headers.get('cookie') ?? '' } })
  if (!res.ok) throw new Error(`preview lookup failed (${res.status})`)
  const body = (await res.json()) as { document?: PrintableDocument }
  if (!body.document) throw new Error('preview returned no document')
  return body.document
}

export async function resolveDocumentHeading(
  req: Request,
  selector: DocumentSelector,
): Promise<{ headingTh: string; number: string; grandTotal: number; currencyCode: string }> {
  const url = new URL(req.url)
  const target = new URL('/api/orva_documents/preview', url.origin)
  target.searchParams.set('type', selector.type)
  if (selector.template) target.searchParams.set('template', selector.template)
  if (selector.documentId) target.searchParams.set('documentId', selector.documentId)

  const res = await fetch(target, { headers: { cookie: req.headers.get('cookie') ?? '' } })
  if (!res.ok) throw new Error(`preview lookup failed (${res.status})`)
  const body = (await res.json()) as {
    document?: { headingTh?: string; number?: string; grandTotal?: number; currencyCode?: string }
  }
  return {
    headingTh: body.document?.headingTh ?? 'เอกสาร',
    number: body.document?.number ?? '',
    grandTotal: Number(body.document?.grandTotal ?? 0),
    currencyCode: body.document?.currencyCode ?? 'THB',
  }
}
