"use client"
import * as React from 'react'
import type { PrintableDocument } from '../../lib/document'

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

/**
 * The line table. Takes the whole document rather than just its lines so that
 * hiding money cannot be forgotten at a call site: a ใบส่งของ with
 * `showPrices: false` drops the two money columns here, for every template
 * that uses this table.
 */
export function LineItemsTable({ doc, t }: TemplateProps) {
  const { lines, showPrices } = doc
  const columns = showPrices ? 5 : 3
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-y bg-muted/40">
          <th className="w-10 px-2 py-2 text-right font-semibold">#</th>
          <th className="px-2 py-2 text-left font-semibold">{t('orva_documents.field.description', 'รายการ')}</th>
          <th className="w-24 px-2 py-2 text-right font-semibold">{t('orva_documents.field.quantity', 'จำนวน')}</th>
          {showPrices ? (
            <>
              <th className="w-32 px-2 py-2 text-right font-semibold">{t('orva_documents.field.unitPrice', 'ราคาต่อหน่วย')}</th>
              <th className="w-32 px-2 py-2 text-right font-semibold">{t('orva_documents.field.amount', 'จำนวนเงิน')}</th>
            </>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {lines.map((line, index) => (
          <tr key={`${line.description}-${index}`} className="border-b">
            <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{index + 1}</td>
            <td className="px-2 py-2">{line.description}</td>
            <td className="px-2 py-2 text-right tabular-nums">{formatQuantity(line.quantity)}</td>
            {showPrices ? (
              <>
                <td className="px-2 py-2 text-right tabular-nums">{formatMoney(line.unitPrice)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatMoney(line.amount)}</td>
              </>
            ) : null}
          </tr>
        ))}
        {lines.length === 0 ? (
          <tr>
            <td colSpan={columns} className="px-2 py-6 text-center text-muted-foreground">
              {t('orva_documents.preview.noLines', 'เอกสารนี้ยังไม่มีรายการ')}
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  )
}

export function TotalsBlock({ doc, t }: TemplateProps) {
  // A ใบส่งของ that hides prices has no totals to state either.
  if (!doc.showPrices) return null
  const rows: Array<[string, number]> = doc.isAbbreviated
    // retail slip: amounts already include VAT; state the VAT contained
    ? [[`${t('orva_documents.field.vatIncludedAmount', 'ภาษีมูลค่าเพิ่มที่รวมอยู่')}${doc.taxRate !== null ? ` ${doc.taxRate}%` : ''}`, doc.taxAmount]]
    : [[t('orva_documents.field.subtotal', 'รวมเป็นเงิน'), doc.subtotal]]
  if (!doc.isAbbreviated) {
    if (doc.discount > 0) rows.push([t('orva_documents.field.discount', 'ส่วนลด'), -doc.discount])
    rows.push([
      doc.taxRate !== null
        ? `${t('orva_documents.field.vat', 'ภาษีมูลค่าเพิ่ม')} ${doc.taxRate}%`
        : t('orva_documents.field.vat', 'ภาษีมูลค่าเพิ่ม'),
      doc.taxAmount,
    ])
  }

  return (
    <div className="flex flex-col gap-1 text-sm">
      {doc.isAbbreviated ? <div className="text-xs font-medium">{t('orva_documents.field.vatIncluded', 'ราคารวมภาษีมูลค่าเพิ่มแล้ว')}</div> : null}
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
  if (!doc.showPrices || !doc.amountInWords) return null
  return (
    <div className="rounded border bg-muted/30 px-3 py-2 text-sm">
      <span className="text-muted-foreground">{t('orva_documents.field.amountInWords', 'จำนวนเงินเป็นตัวอักษร')}: </span>
      <span className="font-medium">{doc.amountInWords}</span>
    </div>
  )
}

/** ต้นฉบับ (สำหรับลูกค้า) or สำเนา (สำหรับบริษัท) — tax documents and ใบส่งของ print both. */
export function CopyRoleLabel({ doc, t }: TemplateProps) {
  if (!doc.isTaxDocument && !doc.isDeliveryNote) return null
  return (
    <span>
      {doc.copyRole === 'copy'
        ? t('orva_documents.copy.copy', 'สำเนา (สำหรับบริษัท)')
        : t('orva_documents.copy.original', 'ต้นฉบับ (สำหรับลูกค้า)')}
    </span>
  )
}

/** Standard terms from settings — the statutory form's หมายเหตุ clauses. */
export function TermsBlock({ doc, t }: TemplateProps) {
  if (!doc.terms) return null
  return (
    <div className="text-xs leading-5">
      <div className="font-semibold">{t('orva_documents.field.terms', 'เงื่อนไข')}</div>
      <p className="whitespace-pre-line text-muted-foreground">{doc.terms}</p>
    </div>
  )
}

/**
 * Credit/debit note reference — ป.82/2542 requires the original tax invoice
 * number and date, the correct amount, the difference and the reason.
 */
export function ReferenceBlock({ doc, t }: TemplateProps) {
  if (!doc.reference) return null
  const r = doc.reference
  return (
    <div className="rounded border px-3 py-2 text-sm">
      <div className="mb-1 font-semibold">{t('orva_documents.reference.title', 'อ้างอิงใบกำกับภาษีเดิม')}</div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs">
        <div>{t('orva_documents.reference.invoice', 'เลขที่ใบกำกับภาษีเดิม')}: <span className="font-medium">{r.invoiceNumber}</span>{r.invoiceDate ? ` · ${formatThaiDate(r.invoiceDate)}` : ''}</div>
        <div>{t('orva_documents.reference.original', 'มูลค่าตามใบกำกับภาษีเดิม')}: <span className="tabular-nums">{formatMoney(r.originalAmount)}</span></div>
        <div>{t('orva_documents.reference.correct', 'มูลค่าที่ถูกต้อง')}: <span className="tabular-nums">{formatMoney(r.correctAmount)}</span></div>
        <div>{t('orva_documents.reference.difference', 'ผลต่าง')}: <span className="font-medium tabular-nums">{formatMoney(r.difference)}</span></div>
        <div className="col-span-2">{t('orva_documents.reference.reason', 'สาเหตุ')}: {r.reason}</div>
      </div>
    </div>
  )
}

/** การชำระเงิน block from settings — bank account and terms, every type. */
export function PaymentDetailsBlock({ doc, t }: TemplateProps) {
  if (!doc.paymentDetails) return null
  return (
    <div className="text-xs leading-5">
      <div className="font-semibold">{t('orva_documents.brand.paymentDetails', 'การชำระเงิน')}</div>
      <p className="whitespace-pre-line text-muted-foreground">{doc.paymentDetails}</p>
    </div>
  )
}

/**
 * ใบส่งของ: what the sheet states about the delivery itself.
 *
 * Prints on a delivery note even when nothing has been recorded — a blank
 * dotted line is a form the driver can fill in by hand, which is how most of
 * these are still completed. No receiver name is ever stored (Q-004); the
 * signature block below carries it on paper only.
 */
export function DeliveryFactsBlock({ doc, t }: TemplateProps) {
  if (!doc.delivery) return null
  const { deliveredOn, carrier, trackingNumbers, address, note } = doc.delivery
  const tracking = (trackingNumbers ?? []).filter((value) => value.trim().length > 0)
  const blank = <span className="inline-block min-w-32 border-b border-dotted align-bottom" />
  return (
    <div className="rounded border px-3 py-2 text-xs leading-6">
      <div className="mb-1 text-sm font-semibold">{t('orva_documents.delivery.title', 'รายละเอียดการส่งของ')}</div>
      <div className="grid grid-cols-2 gap-x-6">
        <div>
          {t('orva_documents.delivery.deliveredOn', 'วันที่ส่งของ')}:{' '}
          {deliveredOn ? <span className="font-medium">{formatThaiDate(deliveredOn)}</span> : blank}
        </div>
        <div>
          {t('orva_documents.delivery.carrier', 'ผู้ขนส่ง/พาหนะ')}: {carrier ? <span className="font-medium">{carrier}</span> : blank}
        </div>
        <div className="col-span-2">
          {t('orva_documents.delivery.address', 'สถานที่ส่ง')}: {address ? <span className="font-medium">{address}</span> : blank}
        </div>
        {tracking.length ? (
          <div className="col-span-2">
            {t('orva_documents.delivery.tracking', 'เลขติดตามพัสดุ')}: <span className="font-medium tabular-nums">{tracking.join(', ')}</span>
          </div>
        ) : null}
        {note ? <div className="col-span-2">{t('orva_documents.delivery.note', 'หมายเหตุการส่ง')}: <span className="font-medium">{note}</span></div> : null}
      </div>
    </div>
  )
}

export function SignatureRow({ doc, t }: TemplateProps) {
  // A delivery note is signed by the two people who handled the goods, and
  // each signature is dated: the receiver's date is the delivery date the
  // office will later record, so the paper must ask for it.
  const slots = doc.isDeliveryNote
    ? [
        t('orva_documents.field.signatureConsignor', 'ผู้ส่งสินค้า'),
        t('orva_documents.field.signatureConsignee', 'ผู้รับสินค้า'),
      ]
    : [
        t('orva_documents.field.signatureBuyer', 'ผู้รับสินค้า/บริการ'),
        t('orva_documents.field.signatureSeller', 'ผู้มีอำนาจลงนาม'),
      ]
  return (
    <div className="mt-8 grid grid-cols-2 gap-10 text-center text-xs text-muted-foreground">
      {slots.map((slot) => (
        <div key={slot} className="flex flex-col gap-2">
          <div className="mt-8 border-t border-dashed" />
          <span>{slot}</span>
          {doc.isDeliveryNote ? (
            <span className="text-xs">{t('orva_documents.delivery.signedOn', 'วันที่ ......... / ......... / .........')}</span>
          ) : null}
        </div>
      ))}
    </div>
  )
}
