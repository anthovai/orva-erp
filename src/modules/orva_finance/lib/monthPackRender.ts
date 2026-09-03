import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { MonthPack } from '../data/entities'
import { assembleZip, packFileName, planMonthPack, type PackPlan, type RenderedPdf } from './monthPack'
import type { Scope } from './reportQueries'

const logger = createLogger('orva_finance').child({ component: 'month-pack' })

/**
 * Renders the ใบกำกับภาษี + ใบเสร็จรับเงิน PDFs of the month through the
 * documents module's own PDF endpoint, forwarding the requester's cookies so
 * the render is scoped exactly like the screen. One failure (no Chromium,
 * a document that will not render) is reported in the cover sheet, not
 * thrown: an accountant with CSVs and a note beats no pack at all.
 */
export async function renderTaxDocumentPdfs(req: Request, plan: PackPlan): Promise<{ pdfs: RenderedPdf[]; note: string | null }> {
  const origin = new URL(req.url).origin
  const cookie = req.headers.get('cookie') ?? ''
  const pdfs: RenderedPdf[] = []
  const failures: string[] = []
  for (const doc of plan.taxDocuments) {
    for (const [type, label] of [['tax_invoice', 'ใบกำกับภาษี'], ['receipt', 'ใบเสร็จรับเงิน']] as const) {
      const url = `${origin}/api/orva_documents/pdf?type=${type}&documentId=${doc.id}`
      try {
        const res = await fetch(url, { headers: { cookie }, cache: 'no-store' })
        if (res.status === 503) {
          const body = (await res.json().catch(() => ({}))) as { code?: string }
          if (body.code === 'pdf_browser_unavailable') {
            return { pdfs, note: 'ไม่ได้แนบ PDF เอกสารภาษี — เซิร์ฟเวอร์นี้ยังไม่ได้ตั้ง ORVA_PDF_BROWSER_PATH (พิมพ์จากหน้า preview แทน)' }
          }
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        pdfs.push({ name: `${label}-${doc.invoice_number}.pdf`.replace(/[\\/:*?"<>|]/g, '-'), data: new Uint8Array(await res.arrayBuffer()) })
      } catch (error) {
        logger.warn('Tax document PDF skipped', { documentId: doc.id, type, err: error instanceof Error ? error.message : String(error) })
        failures.push(`${label} ${doc.invoice_number}`)
      }
    }
  }
  return { pdfs, note: failures.length ? `แปลง PDF ไม่สำเร็จ ${failures.length} ไฟล์: ${failures.join(', ')}` : null }
}

export type BuiltPack = { plan: PackPlan; zip: Uint8Array; fileName: string; pdfCount: number; pdfNote: string | null }

export async function buildPack(req: Request, tem: EntityManager, scope: Scope, month: string, includePdf: boolean): Promise<BuiltPack> {
  const plan = await planMonthPack(tem, scope, month)
  const rendered = includePdf ? await renderTaxDocumentPdfs(req, plan) : { pdfs: [], note: 'ไม่ได้แนบ PDF เอกสารภาษีตามที่เลือก' }
  const zip = assembleZip(plan, rendered.pdfs, rendered.note)
  return { plan, zip, fileName: packFileName(month), pdfCount: rendered.pdfs.length, pdfNote: rendered.note }
}

/** History row — a pack that left the building (or tried to). */
export function recordPack(tem: EntityManager, scope: Scope & { organizationId: string }, built: BuiltPack, extra: { status: 'generated' | 'sent' | 'failed'; sentTo?: string | null; createdBy?: string | null }): MonthPack {
  const now = new Date()
  const row = tem.create(MonthPack, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    month: built.plan.month,
    status: extra.status,
    fileName: built.fileName,
    fileSize: built.zip.byteLength,
    sentTo: extra.sentTo ?? null,
    sentAt: extra.status === 'sent' ? now : null,
    summary: { ...built.plan.figures, pdfCount: built.pdfCount, pdfNote: built.pdfNote, checklist: built.plan.checklist },
    createdBy: extra.createdBy ?? null,
    createdAt: now,
    updatedAt: now,
  })
  tem.persist(row)
  return row
}
