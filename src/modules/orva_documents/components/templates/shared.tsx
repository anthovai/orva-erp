"use client"
import * as React from 'react'
import type { DocumentLine, PrintableDocument } from '../../lib/document'

/**
 * Pieces every template shares. Templates differ in layout and weight, not in
 * what a Thai document is required to state — keeping the statutory blocks
 * here means a new template cannot accidentally omit one.
 */

export function formatMoney(value: number): string {
  return value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatQuantity(value: number): string {
  return value.toLocaleString('th-TH', { maximumFractionDigits: 4 })
}

/** Thai Buddhist-era date, the form printed on Thai paperwork. */
export function formatThaiDate(iso: string | null): string {
  if (!iso) return '-'
  const parsed = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return iso
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
  return `${parsed.getDate()} ${months[parsed.getMonth()]} ${parsed.getFullYear() + 543}`
}

export type TemplateProps = {
  doc: PrintableDocument
  t: (key: string, fallback?: string) => string
}

/** Taxpayer id + branch — the block that makes a Thai tax document valid. */
export function TaxIdentityLine({ taxId, branch, t }: { taxId?: string | null; branch?: string | null; t: TemplateProps['t'] }) {
  return (
    <div className="text-xs leading-5">
      <span className="text-muted-foreground">{t('orva_documents.field.taxId', 'เลขประจำตัวผู้เสียภาษี')}: </span>
      <span className="font-medium tabular-nums">{taxId && taxId.length ? taxId : '-'}</span>
      <span className="text-muted-foreground"> · {t('orva_documents.field.branch', 'สาขา')}: </span>
      <span className="font-medium">{branch && branch.length ? branch : '-'}</span>
    </div>
  )
}

export function PartyBlock({
  title,
  party,
  showTaxIdentity,
  t,
}: {
  title: string
  party: PrintableDocument['seller']
  showTaxIdentity: boolean
  t: TemplateProps['t']
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="text-sm font-semibold">{party.name}</div>
      {party.address ? <div className="text-xs leading-5 text-muted-foreground">{party.address}</div> : null}
      {party.phone || party.email ? (
        <div className="text-xs text-muted-foreground">
          {[party.phone, party.email].filter(Boolean).join(' · ')}
        </div>
      ) : null}
      {showTaxIdentity ? <TaxIdentityLine taxId={party.taxId} branch={party.branch} t={t} /> : null}
    </div>
  )
}

export function LineItemsTable({ lines, t }: { lines: DocumentLine[]; t: TemplateProps['t'] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-y bg-muted/40">
          <th className="w-10 px-2 py-2 text-right font-semibold">#</th>
          <th className="px-2 py-2 text-left font-semibold">{t('orva_documents.field.description', 'รายการ')}</th>
          <th className="w-24 px-2 py-2 text-right font-semibold">{t('orva_documents.field.quantity', 'จำนวน')}</th>
          <th className="w-32 px-2 py-2 text-right font-semibold">{t('orva_documents.field.unitPrice', 'ราคาต่อหน่วย')}</th>
          <th className="w-32 px-2 py-2 text-right font-semibold">{t('orva_documents.field.amount', 'จำนวนเงิน')}</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line, index) => (
          <tr key={`${line.description}-${index}`} className="border-b">
            <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{index + 1}</td>
            <td className="px-2 py-2">{line.description}</td>
            <td className="px-2 py-2 text-right tabular-nums">{formatQuantity(line.quantity)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{formatMoney(line.unitPrice)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{formatMoney(line.amount)}</td>
          </tr>
        ))}
        {lines.length === 0 ? (
          <tr>
            <td colSpan={5} className="px-2 py-6 text-center text-muted-foreground">
              {t('orva_documents.preview.noLines', 'เอกสารนี้ยังไม่มีรายการ')}
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  )
}

export function TotalsBlock({ doc, t }: TemplateProps) {
  const rows: Array<[string, number]> = [
    [t('orva_documents.field.subtotal', 'รวมเป็นเงิน'), doc.subtotal],
  ]
  if (doc.discount > 0) rows.push([t('orva_documents.field.discount', 'ส่วนลด'), -doc.discount])
  rows.push([
    doc.taxRate !== null
      ? `${t('orva_documents.field.vat', 'ภาษีมูลค่าเพิ่ม')} ${doc.taxRate}%`
      : t('orva_documents.field.vat', 'ภาษีมูลค่าเพิ่ม'),
    doc.taxAmount,
  ])

  return (
    <div className="flex flex-col gap-1 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-6">
          <span className="text-muted-foreground">{label}</span>
          <span className="tabular-nums">{formatMoney(value)}</span>
        </div>
      ))}
      <div className="mt-1 flex justify-between gap-6 border-t pt-2 text-base font-semibold">
        <span>{t('orva_documents.field.grandTotal', 'จำนวนเงินรวมทั้งสิ้น')}</span>
        <span className="tabular-nums">
          {formatMoney(doc.grandTotal)} {doc.currencyCode}
        </span>
      </div>
    </div>
  )
}

/** Amount in words — Thai accountants read this line, not just the figures. */
export function AmountInWords({ doc, t }: TemplateProps) {
  // Absent for non-THB documents; an empty label would read as a missing value.
  if (!doc.amountInWords) return null
  return (
    <div className="rounded border bg-muted/30 px-3 py-2 text-sm">
      <span className="text-muted-foreground">{t('orva_documents.field.amountInWords', 'จำนวนเงินเป็นตัวอักษร')}: </span>
      <span className="font-medium">{doc.amountInWords}</span>
    </div>
  )
}

export function SignatureRow({ t }: { t: TemplateProps['t'] }) {
  const slots = [
    t('orva_documents.field.signatureBuyer', 'ผู้รับสินค้า/บริการ'),
    t('orva_documents.field.signatureSeller', 'ผู้มีอำนาจลงนาม'),
  ]
  return (
    <div className="mt-8 grid grid-cols-2 gap-10 text-center text-xs text-muted-foreground">
      {slots.map((slot) => (
        <div key={slot} className="flex flex-col gap-2">
          <div className="mt-8 border-t border-dashed" />
          <span>{slot}</span>
        </div>
      ))}
    </div>
  )
}
