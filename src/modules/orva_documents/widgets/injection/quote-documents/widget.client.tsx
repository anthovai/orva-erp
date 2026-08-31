"use client"
import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DOCUMENT_TYPES, type DocumentType } from '../../../lib/document'

const TYPE_LABELS: Record<DocumentType, { key: string; fallback: string }> = {
  quotation: { key: 'orva_documents.type.quotation', fallback: 'ใบเสนอราคา' },
  invoice: { key: 'orva_documents.type.invoice', fallback: 'ใบแจ้งหนี้' },
  tax_invoice: { key: 'orva_documents.type.tax_invoice', fallback: 'ใบกำกับภาษี' },
  receipt: { key: 'orva_documents.type.receipt', fallback: 'ใบกำกับภาษี/ใบเสร็จรับเงิน' },
}

/**
 * The bridge from a quote to its printable Thai documents, injected into the
 * installed quote detail screen (`sales.document.detail.quote:details`).
 *
 * This exists so nobody has to know that a separate เอกสาร screen exists:
 * you are looking at the quote, you click the document you need, and you land
 * on the preview already scoped to this record. One link per type because
 * that is how the operator thinks — "ออกใบกำกับภาษีจากใบเสนอราคานี้",
 * not "open the document tool and find the record again".
 */
export default function QuoteDocumentsWidget({ data }: { data?: Record<string, unknown> }) {
  const t = useT()
  const quoteId = typeof data?.id === 'string' ? data.id : null
  if (!quoteId) return null

  return (
    <div className="space-y-2 rounded-md border p-4">
      <p className="text-sm font-semibold">
        {t('orva_documents.quoteWidget.title', 'เอกสารจากใบเสนอราคานี้')}
      </p>
      <p className="text-xs text-muted-foreground">
        {t(
          'orva_documents.quoteWidget.hint',
          'เปิดตัวอย่างเอกสารจากข้อมูลใบนี้ — พิมพ์ ดาวน์โหลด PDF หรือส่งอีเมลได้จากหน้าตัวอย่าง',
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        {DOCUMENT_TYPES.map((type) => (
          <Button key={type} asChild variant="outline" size="sm">
            <a href={`/backend/documents/preview?type=${type}&documentId=${encodeURIComponent(quoteId)}`}>
              {t(TYPE_LABELS[type].key, TYPE_LABELS[type].fallback)}
            </a>
          </Button>
        ))}
      </div>
    </div>
  )
}
