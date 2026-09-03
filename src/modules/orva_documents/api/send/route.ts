import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { sendSchema } from '../../data/validators'
import { loadSettings } from '../../lib/source'
import { sendEtaxEmail } from '../../lib/etaxEmail'
import { DocumentEmail } from '../../emails/DocumentEmail'
import { BrowserUnavailableError, pdfFileName, renderDocumentPdf } from '../../lib/pdf'
import { buildDocumentUrl, readCookie, resolveDocumentHeading } from '../../lib/request'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['orva_documents.view'] },
}

const logger = createLogger('orva_documents').child({ component: 'send' })
const responseSchema = z.object({ ok: z.boolean(), fileName: z.string(), bytes: z.number(), etax: z.boolean() })

/**
 * Emails the document to a customer as a PDF attachment.
 *
 * The PDF is rendered first and the mail is only sent once it exists — a
 * cover note promising an attachment that failed to render would be worse
 * than an error.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()

  const parsed = sendSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) {
    return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  }
  const { to, type, template, documentId, message, etax } = parsed.data

  const authToken = readCookie(req, 'auth_token')
  if (!authToken) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // e-Tax Invoice by Email: statutory documents only, and only once the
  // RD-registered sender address is configured — a CC to the time-stamp
  // system from an unregistered address would simply be rejected there.
  let etaxSender: string | null = null
  if (etax) {
    if (type !== 'tax_invoice' && type !== 'receipt') {
      return Response.json({ error: 'e-Tax applies to tax documents only' }, { status: 400 })
    }
    if (!documentId) {
      return Response.json({ error: 'e-Tax requires a real document, not sample data' }, { status: 400 })
    }
    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    const settings = await withTenantRls(em, auth.tenantId, (tem) =>
      loadSettings(tem, { tenantId: auth.tenantId!, organizationId }),
    )
    etaxSender = settings?.etaxSenderEmail?.trim() || null
    if (!etaxSender) {
      return Response.json(
        { error: 'e-Tax sender email is not configured', code: 'etax_sender_missing' },
        { status: 400 },
      )
    }
  }

  const url = new URL(req.url)
  const selector = { type, template, documentId }

  let pdf: Uint8Array
  let heading: Awaited<ReturnType<typeof resolveDocumentHeading>>
  try {
    heading = await resolveDocumentHeading(req, selector)
    pdf = await renderDocumentPdf({
      url: buildDocumentUrl(url, selector),
      authToken,
      host: url.hostname,
      locale: readCookie(req, 'locale') ?? undefined,
    })
  } catch (error) {
    if (error instanceof BrowserUnavailableError) {
      return Response.json({ error: error.message, code: 'pdf_browser_unavailable' }, { status: 503 })
    }
    logger.error('Document render failed before sending', {
      type,
      documentId: documentId ?? null,
      err: error instanceof Error ? error.message : String(error),
    })
    return Response.json({ error: 'Could not render the document as PDF' }, { status: 500 })
  }

  const { translate } = await resolveTranslations()
  const fileName = pdfFileName(heading.headingTh, heading.number)
  const totalText = `${heading.grandTotal.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${heading.currencyCode}`
  const documentLabel = `${heading.headingTh}${heading.number ? ` ${heading.number}` : ''}`

  try {
    const emailBody = DocumentEmail({
        copy: {
          preview: documentLabel,
          heading: documentLabel,
          intro: message?.trim()
            ? message.trim()
            : translate('orva_documents.email.intro', 'เอกสารของคุณแนบมากับอีเมลฉบับนี้แล้ว'),
          total: `${translate('orva_documents.field.grandTotal', 'จำนวนเงินรวมทั้งสิ้น')}: ${totalText}`,
          attachmentNote: translate('orva_documents.email.attachmentNote', 'ไฟล์แนบเป็น PDF — เปิดหรือบันทึกเก็บไว้ได้'),
          footer: translate('orva_documents.email.footer', 'ส่งจากระบบ Orva'),
        },
      })
    const attachment = {
      filename: fileName,
      content: Buffer.from(pdf).toString('base64'),
      contentType: 'application/pdf',
    }
    if (etax && etaxSender) {
      // buyer in TO, ETDA time-stamp system in CC, RD-registered sender,
      // exactly one attachment — the by-email program's rules
      await sendEtaxEmail({ to, from: etaxSender, subject: documentLabel, react: emailBody, attachment })
    } else {
      await sendEmail({ to, subject: documentLabel, react: emailBody, attachments: [attachment] })
    }
  } catch (error) {
    logger.error('Document email failed', {
      to,
      err: error instanceof Error ? error.message : String(error),
    })
    return Response.json({ error: 'Could not send the email' }, { status: 502 })
  }

  // What went out, and how big it was: the only record that a customer was
  // sent this exact document, and the first thing anyone checks when they ask
  // whether the attachment was really there.
  logger.info('Document emailed', { to, type, fileName, bytes: pdf.byteLength, etax: !!etax })

  return Response.json({ ok: true, fileName, bytes: pdf.byteLength, etax: !!etax })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Documents',
  summary: 'Email the document',
  methods: {
    POST: {
      summary: 'Render the document to PDF and email it as an attachment',
      description:
        'The PDF is rendered before the mail is sent, so a delivered email always carries the document. Requires a Chromium executable (ORVA_PDF_BROWSER_PATH) and RESEND_API_KEY. With etax=true (tax documents only), the mail is sent from the RD-registered sender with a CC to the ETDA time-stamp system (e-Tax Invoice by Email).',
      tags: ['Orva Documents'],
      requestBody: { schema: sendSchema },
      responses: [{ status: 200, description: 'Sent, with the attached file name.', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid payload', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) },
        { status: 502, description: 'Mail delivery failed', schema: z.object({ error: z.string() }) },
        { status: 503, description: 'No Chromium available for rendering', schema: z.object({ error: z.string(), code: z.string() }) },
      ],
    },
  },
}
