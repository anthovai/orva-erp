import * as React from 'react'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { sendEmail } from '@open-mercato/shared/lib/email/send'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { GlSettings } from '../../../../data/entities'
import { monthPackSendSchema } from '../../../../data/validators'
import { thaiMonthName } from '../../../../lib/monthPack'
import { buildPack, recordPack } from '../../../../lib/monthPackRender'
import { orvaFinanceTag } from '../../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['orva_finance.gl.manage'] },
}

const responseSchema = z.object({
  ok: z.literal(true),
  id: z.string(),
  sentTo: z.string(),
  fileName: z.string(),
  fileSize: z.number(),
  pdfCount: z.number(),
  delivered: z.boolean(),
})

const fmt = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Builds the month pack and emails it to the accounting firm. The address
 * comes from GL settings unless overridden for this send. Every attempt is
 * recorded (sent / failed) so the home screen can say "already sent" and the
 * owner can see who received what.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = monthPackSendSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 })
  const scope = { tenantId: auth.tenantId, organizationId }
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const outcome = await withTenantRls(em, scope.tenantId, async (tem) => {
      const settings = await tem.findOne(GlSettings, { tenantId: scope.tenantId, organizationId })
      const to = parsed.data.to ?? settings?.accountantEmail ?? null
      if (!to) throw Object.assign(new Error('No accountant email — set one in GL settings or pass `to`'), { status: 400 })

      const built = await buildPack(req, tem, scope, parsed.data.month, parsed.data.includePdf !== false)
      const f = built.plan.figures
      const monthLabel = thaiMonthName(parsed.data.month)
      const company = built.plan.companyName ?? ''
      const subject = `ชุดปิดเดือน ${monthLabel}${company ? ` — ${company}` : ''}`
      const lines = [
        `เรียน ${settings?.accountantName ?? 'สำนักงานบัญชี'}`,
        `แนบชุดปิดเดือน ${monthLabel}${company ? ` ของ ${company}` : ''} มาให้ในไฟล์ zip`,
        `ภาษีขาย ${fmt(f.vatOutput)} ภาษีซื้อ ${fmt(f.vatInput)} ${f.vatNet >= 0 ? 'ภ.พ.30 ต้องชำระ' : 'ภ.พ.30 ชำระเกิน'} ${fmt(Math.abs(f.vatNet))}`,
        `ภาษีหัก ณ ที่จ่ายที่ต้องนำส่ง (ภ.ง.ด.3/53) ${fmt(f.whtPayable)} · ถูกหักไว้ ${fmt(f.whtReceivable)}`,
        `รายได้ ${fmt(f.income)} ค่าใช้จ่าย ${fmt(f.expense)} กำไรสุทธิ ${fmt(f.netProfit)} · เงินสดปลายเดือน ${fmt(f.cashClosing)}`,
        `เอกสารภาษี ${f.taxDocumentCount} ชุด${built.pdfNote ? ` (${built.pdfNote})` : ' แนบเป็น PDF ในโฟลเดอร์ เอกสารภาษี'}`,
        parsed.data.message ?? null,
        'รายละเอียดทั้งหมดอยู่ใน 00-สรุปเดือน.txt ภายในไฟล์แนบ',
      ].filter((line): line is string => Boolean(line))

      const body = React.createElement(
        'div',
        { style: { fontFamily: 'sans-serif', fontSize: 14, lineHeight: 1.6 } },
        ...lines.map((line, index) => React.createElement('p', { key: index, style: { margin: '0 0 8px' } }, line)),
      )

      let delivered = false
      try {
        const result = await sendEmail({
          to,
          subject,
          react: body,
          attachments: [{ filename: built.fileName, content: Buffer.from(built.zip).toString('base64'), contentType: 'application/zip' }],
        })
        delivered = Boolean((result as { delivered?: boolean } | undefined)?.delivered ?? true)
      } catch (error) {
        recordPack(tem, scope, built, { status: 'failed', sentTo: to, createdBy: auth.sub ?? null })
        await tem.flush()
        throw Object.assign(new Error(error instanceof Error ? error.message : 'Email failed'), { status: 502 })
      }
      const row = recordPack(tem, scope, built, { status: 'sent', sentTo: to, createdBy: auth.sub ?? null })
      await tem.flush()
      return { ok: true as const, id: row.id, sentTo: to, fileName: built.fileName, fileSize: built.zip.byteLength, pdfCount: built.pdfCount, delivered }
    })
    return Response.json(outcome)
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500
    return Response.json({ error: error instanceof Error ? error.message : 'Could not send the month pack' }, { status })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaFinanceTag,
  summary: 'Send the month pack to the accountant',
  methods: {
    POST: {
      summary: 'Build the ชุดปิดเดือน zip and email it to the accounting firm',
      tags: [orvaFinanceTag],
      requestBody: { schema: monthPackSendSchema },
      responses: [{ status: 200, description: 'Sent.', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid payload or no accountant address', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) },
        { status: 502, description: 'Email provider rejected the message', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
