"use client"
import * as React from 'react'
import {
  AmountInWords,
  TaxIdentityLine,
  formatThaiDate,
  type TemplateProps,
} from './shared'

const money = (value: number) => value.toLocaleString('th-TH', { minimumFractionDigits: 2 })

/**
 * Modelled on the tenant's own letterhead (the Kaiser Klowns papers the user
 * brought): a coloured masthead, an "เรียกเก็บที่" label grid, a coloured
 * table head, full-width summary rows, payment terms beside a client
 * signature line, and a coloured contact footer. The colour is the TENANT'S
 * (ตั้งค่าเอกสาร → brandColor), not Orva's — this is their paper.
 *
 * The accent arrives as inline styles by necessity: it is tenant data
 * resolved at render time, which no build-time design token can express.
 */
export function BrandTemplate({ doc, t }: TemplateProps) {
  const accent = doc.accentColor ?? '#11836E'
  return (
    <div className="flex flex-col text-foreground">
      {/* masthead */}
      <div className="flex items-start justify-between gap-6 pb-4">
        <div className="flex items-start gap-4 pt-1">
          {doc.logoHeader ? (
            // eslint-disable-next-line @next/next/no-img-element -- data URI from tenant settings; next/image cannot optimize it
            <img src={doc.logoHeader} alt="" className="h-20 w-20 shrink-0 object-contain" />
          ) : null}
          <div>
            <div className="text-xl font-extrabold uppercase leading-tight" style={{ color: accent }}>
              {doc.seller.name}
            </div>
            {doc.isTaxDocument ? <TaxIdentityLine taxId={doc.seller.taxId} branch={doc.seller.branch} t={t} /> : null}
          </div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-extrabold leading-none" style={{ color: accent }}>{doc.headingEn}</div>
          <div className="text-lg font-semibold">{doc.headingTh}</div>
          <div className="mt-1 text-xs">
            <span className="font-semibold">{t('orva_documents.field.number', 'เลขที่')} / NO </span>
            <span className="tabular-nums">{doc.number || '-'}</span>
          </div>
          <div className="text-xs">
            <span className="font-semibold">{t('orva_documents.field.issueDate', 'วันที่')}: </span>
            {formatThaiDate(doc.issueDate)}
            {doc.secondaryDateLabelKey && doc.secondaryDate ? (
              <>
                {' · '}
                <span className="font-semibold">{t(doc.secondaryDateLabelKey, '')}: </span>
                {formatThaiDate(doc.secondaryDate)}
              </>
            ) : null}
          </div>
          {doc.isTaxDocument ? <div className="text-xs">{t('orva_documents.copy.original', 'ต้นฉบับ')}</div> : null}
        </div>
      </div>

      {/* เรียกเก็บที่ */}
      <div className="mb-4">
        <div className="mb-1 text-sm font-bold">{t('orva_documents.brand.billTo', 'เรียกเก็บที่')}</div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-0.5 text-sm">
          <div>
            <span className="font-semibold" style={{ color: accent }}>{t('orva_documents.brand.customerName', 'ชื่อลูกค้า')}: </span>
            {doc.buyer.name}
          </div>
          <div className="row-span-3">
            <span className="font-semibold" style={{ color: accent }}>{t('orva_documents.brand.address', 'ที่อยู่')}: </span>
            {doc.buyer.address ?? '-'}
          </div>
          {doc.isTaxDocument || doc.buyer.taxId ? (
            <div>
              <span className="font-semibold" style={{ color: accent }}>{t('orva_documents.field.taxId', 'เลขประจำตัวผู้เสียภาษี')}: </span>
              <span className="tabular-nums">{doc.buyer.taxId ?? '-'}</span>
              {doc.buyer.branch ? ` · ${t('orva_documents.field.branch', 'สาขา')}: ${doc.buyer.branch}` : ''}
            </div>
          ) : null}
          {doc.buyer.phone ? (
            <div>
              <span className="font-semibold" style={{ color: accent }}>{t('orva_documents.brand.phone', 'เบอร์โทรลูกค้า')}: </span>
              {doc.buyer.phone}
            </div>
          ) : null}
        </div>
      </div>

      {/* items with a coloured head, summaries as full-width rows like the paper */}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-white" style={{ backgroundColor: accent }}>
            <th className="w-12 px-2 py-2 text-center font-semibold">{t('orva_documents.brand.order', 'ลำดับ')}</th>
            <th className="px-2 py-2 text-left font-semibold">{t('orva_documents.field.description', 'รายการ')}</th>
            <th className="w-16 px-2 py-2 text-center font-semibold">{t('orva_documents.field.quantity', 'จำนวน')}</th>
            <th className="w-28 px-2 py-2 text-right font-semibold">{t('orva_documents.brand.unit', 'หน่วยละ (บาท)')}</th>
            <th className="w-28 px-2 py-2 text-right font-semibold">{t('orva_documents.brand.total', 'รวม (บาท)')}</th>
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((line, index) => (
            <tr key={index} className="border-b align-top">
              <td className="px-2 py-2 text-center tabular-nums">{index + 1}</td>
              <td className="px-2 py-2">{line.description}</td>
              <td className="px-2 py-2 text-center tabular-nums">{line.quantity.toLocaleString('th-TH')}</td>
              <td className="px-2 py-2 text-right tabular-nums">
                {line.unitPrice === 0 ? t('orva_documents.brand.free', 'ฟรี') : money(line.unitPrice)}
              </td>
              <td className="px-2 py-2 text-right tabular-nums">{money(line.amount)}</td>
            </tr>
          ))}
          <tr className="border-b">
            <td colSpan={4} className="px-2 py-2 font-semibold">{t('orva_documents.brand.subtotal', 'รวมค่าบริการทั้งสิ้น')}</td>
            <td className="px-2 py-2 text-right font-semibold tabular-nums">{money(doc.subtotal)}</td>
          </tr>
          {doc.discount > 0 ? (
            <tr className="border-b">
              <td colSpan={4} className="px-2 py-2">{t('orva_documents.field.discount', 'ส่วนลด')}</td>
              <td className="px-2 py-2 text-right tabular-nums">-{money(doc.discount)}</td>
            </tr>
          ) : null}
          <tr className="border-b">
            <td colSpan={4} className="px-2 py-2">
              {t('orva_documents.field.vat', 'ภาษีมูลค่าเพิ่ม')}{doc.taxRate !== null ? ` ${doc.taxRate}%` : ''}
            </td>
            <td className="px-2 py-2 text-right tabular-nums">{money(doc.taxAmount)}</td>
          </tr>
          <tr>
            <td colSpan={4} className="px-2 py-2 font-bold">{t('orva_documents.brand.grand', 'จำนวนเงินสุทธิที่ต้องชำระ')}</td>
            <td className="px-2 py-2 text-right font-bold tabular-nums">
              <span className="orva-ledger-total">{money(doc.grandTotal)}</span>
            </td>
          </tr>
        </tbody>
      </table>

      <div className="mt-2"><AmountInWords doc={doc} t={t} /></div>

      {/* payment terms beside the client signature line, like the paper */}
      <div className="mt-6 grid grid-cols-2 items-end gap-8">
        <div className="space-y-2 text-xs leading-5">
          {doc.paymentDetails ? (
            <div>
              <div className="font-bold">{t('orva_documents.brand.paymentDetails', 'การชำระเงิน')}</div>
              <p className="whitespace-pre-line">{doc.paymentDetails}</p>
            </div>
          ) : null}
          {doc.note ? (
            <div>
              <div className="font-bold">{t('orva_documents.field.note', 'หมายเหตุ')}</div>
              <p className="whitespace-pre-line text-muted-foreground">{doc.note}</p>
            </div>
          ) : null}
        </div>
        <div className="text-center text-sm">
          <div className="mx-8 border-b border-foreground pb-8" />
          <div className="mt-1 font-semibold">Client</div>
        </div>
      </div>

      {/* contact footer band bleeding to the sheet edge */}
      <div className="-mx-10 -mb-10 mt-8 flex items-center gap-6 px-10 py-5 text-white" style={{ backgroundColor: accent }}>
        {doc.logoFooter ? (
          // The mark arrives in its own colours; brightness(0) invert(1)
          // knocks it out to white on the accent band, like the paper.
          // eslint-disable-next-line @next/next/no-img-element -- data URI from tenant settings
          <img
            src={doc.logoFooter}
            alt=""
            className="h-10 max-w-28 shrink-0 object-contain"
            style={{ filter: 'brightness(0) invert(1)' }}
          />
        ) : null}
        <div>
          <div className="text-sm font-bold">{t('orva_documents.brand.contact', 'ช่องทางติดต่อ')}</div>
          <div className="mt-1 flex flex-wrap gap-x-8 gap-y-1 text-xs">
            {doc.seller.address ? <span className="max-w-sm">{doc.seller.address}</span> : null}
            <span>{[doc.seller.phone, doc.seller.email].filter(Boolean).join(' · ')}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
