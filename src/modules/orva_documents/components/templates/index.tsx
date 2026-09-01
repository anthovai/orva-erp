"use client"
import * as React from 'react'
import type { TemplateId } from '../../lib/document'
import { BrandTemplate } from './brand'
import {
  AmountInWords,
  LineItemsTable,
  PartyBlock,
  SignatureRow,
  TaxIdentityLine,
  TotalsBlock,
  formatThaiDate,
  type TemplateProps,
} from './shared'

/**
 * Template registry. Each entry is a full A4 sheet; adding a fourth template
 * is one component plus one row here — nothing else in the module changes.
 * All three render the same PrintableDocument, so a template can differ in
 * layout and weight but never in which statutory facts appear.
 */

function DocumentHeader({ doc, t }: TemplateProps) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="flex flex-col gap-0.5">
        <div className="text-lg font-bold">{doc.seller.name}</div>
        {doc.seller.address ? (
          <div className="max-w-sm text-xs leading-5 text-muted-foreground">{doc.seller.address}</div>
        ) : null}
        {doc.seller.phone || doc.seller.email ? (
          <div className="text-xs text-muted-foreground">{[doc.seller.phone, doc.seller.email].filter(Boolean).join(' · ')}</div>
        ) : null}
        {doc.isTaxDocument ? <TaxIdentityLine taxId={doc.seller.taxId} branch={doc.seller.branch} t={t} /> : null}
      </div>
      <div className="text-right">
        <div className="text-xl font-bold">{doc.headingTh}</div>
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{doc.headingEn}</div>
        {doc.isTaxDocument ? (
          <div className="mt-1 text-xs font-medium">{t('orva_documents.copy.original', 'ต้นฉบับ')}</div>
        ) : null}
      </div>
    </div>
  )
}

function MetaRow({ doc, t }: TemplateProps) {
  return (
    <div className="flex flex-wrap gap-x-8 gap-y-1 text-xs">
      <span>
        <span className="text-muted-foreground">{t('orva_documents.field.number', 'เลขที่')}: </span>
        <span className="font-medium tabular-nums">{doc.number || '-'}</span>
      </span>
      <span>
        <span className="text-muted-foreground">{t('orva_documents.field.issueDate', 'วันที่')}: </span>
        <span className="font-medium">{formatThaiDate(doc.issueDate)}</span>
      </span>
      {doc.secondaryDateLabelKey ? (
        <span>
          <span className="text-muted-foreground">{t(doc.secondaryDateLabelKey, '')}: </span>
          <span className="font-medium">{formatThaiDate(doc.secondaryDate)}</span>
        </span>
      ) : null}
      {doc.paymentMethod ? (
        <span>
          <span className="text-muted-foreground">{t('orva_documents.field.paymentMethod', 'ชำระโดย')}: </span>
          <span className="font-medium">{doc.paymentMethod}</span>
        </span>
      ) : null}
    </div>
  )
}

/** Traditional Thai form: boxed sections, everything ruled. */
function ClassicTemplate({ doc, t }: TemplateProps) {
  return (
    <div className="flex flex-col gap-4 border p-8 text-foreground">
      <DocumentHeader doc={doc} t={t} />
      <div className="border-y py-3">
        <MetaRow doc={doc} t={t} />
      </div>
      <div className="grid grid-cols-2 gap-6 border p-4">
        <PartyBlock title={t('orva_documents.field.seller', 'ผู้ขาย')} party={doc.seller} showTaxIdentity={doc.isTaxDocument} t={t} />
        <PartyBlock title={t('orva_documents.field.buyer', 'ลูกค้า')} party={doc.buyer} showTaxIdentity={doc.isTaxDocument} t={t} />
      </div>
      <LineItemsTable lines={doc.lines} t={t} />
      <div className="grid grid-cols-2 items-start gap-6">
        <AmountInWords doc={doc} t={t} />
        <TotalsBlock doc={doc} t={t} />
      </div>
      {doc.note ? <p className="text-xs leading-5 text-muted-foreground">{doc.note}</p> : null}
      <SignatureRow t={t} />
    </div>
  )
}

/** Orva-branded: a coloured heading band, airy spacing, no outer rules. */
function ModernTemplate({ doc, t }: TemplateProps) {
  return (
    <div className="flex flex-col gap-6 text-foreground">
      <div className="flex items-start justify-between gap-6 rounded-lg bg-primary px-6 py-5 text-primary-foreground">
        <div>
          <div className="text-lg font-bold">{doc.seller.name}</div>
          {doc.seller.address ? <div className="max-w-sm text-xs leading-5 opacity-80">{doc.seller.address}</div> : null}
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold">{doc.headingTh}</div>
          <div className="text-xs uppercase tracking-widest opacity-80">{doc.headingEn}</div>
        </div>
      </div>
      <MetaRow doc={doc} t={t} />
      <div className="grid grid-cols-2 gap-6">
        <PartyBlock title={t('orva_documents.field.seller', 'ผู้ขาย')} party={doc.seller} showTaxIdentity={doc.isTaxDocument} t={t} />
        <PartyBlock title={t('orva_documents.field.buyer', 'ลูกค้า')} party={doc.buyer} showTaxIdentity={doc.isTaxDocument} t={t} />
      </div>
      <LineItemsTable lines={doc.lines} t={t} />
      <div className="flex justify-end">
        <div className="w-72">
          <TotalsBlock doc={doc} t={t} />
        </div>
      </div>
      <AmountInWords doc={doc} t={t} />
      {doc.note ? <p className="text-xs leading-5 text-muted-foreground">{doc.note}</p> : null}
      <SignatureRow t={t} />
    </div>
  )
}

/** Narrow and dense — fits a half sheet, useful for receipts. */
function CompactTemplate({ doc, t }: TemplateProps) {
  return (
    <div className="flex flex-col gap-3 text-sm text-foreground">
      <div className="flex items-baseline justify-between gap-4 border-b pb-2">
        <span className="font-bold">{doc.headingTh}</span>
        <span className="text-xs text-muted-foreground">{doc.headingEn}</span>
      </div>
      <div className="flex flex-col gap-0.5 text-xs">
        <span className="font-semibold">{doc.seller.name}</span>
        {doc.isTaxDocument ? <TaxIdentityLine taxId={doc.seller.taxId} branch={doc.seller.branch} t={t} /> : null}
      </div>
      <MetaRow doc={doc} t={t} />
      <div className="border-y py-2 text-xs">
        <span className="text-muted-foreground">{t('orva_documents.field.buyer', 'ลูกค้า')}: </span>
        <span className="font-medium">{doc.buyer.name}</span>
        {doc.isTaxDocument ? <TaxIdentityLine taxId={doc.buyer.taxId} branch={doc.buyer.branch} t={t} /> : null}
      </div>
      <LineItemsTable lines={doc.lines} t={t} />
      <TotalsBlock doc={doc} t={t} />
      <AmountInWords doc={doc} t={t} />
    </div>
  )
}

export const DOCUMENT_TEMPLATES: Record<TemplateId, { labelKey: string; fallback: string; Component: React.ComponentType<TemplateProps> }> = {
  classic: { labelKey: 'orva_documents.template.classic', fallback: 'แบบราชการ (Classic)', Component: ClassicTemplate },
  modern: { labelKey: 'orva_documents.template.modern', fallback: 'แบบโมเดิร์น (Modern)', Component: ModernTemplate },
  compact: { labelKey: 'orva_documents.template.compact', fallback: 'แบบกระชับ (Compact)', Component: CompactTemplate },
  brand: { labelKey: 'orva_documents.template.brand', fallback: 'แบบแบรนด์ (หัวจดหมายสีกิจการ)', Component: BrandTemplate },
}
