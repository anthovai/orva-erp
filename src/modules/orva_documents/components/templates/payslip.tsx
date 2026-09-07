"use client"
import * as React from 'react'
import { formatThaiDate, formatMoney, type TemplateProps } from './shared'

/**
 * สลิปเงินเดือน — its own layout, not a sales sheet.
 *
 * A payslip answers three questions and nothing else: what was earned, what
 * was deducted and why, and what reached the bank. Running it through the
 * invoice templates printed "ลูกค้า" over the employee's name and a
 * "ภาษีมูลค่าเพิ่ม 0.00" row, which is why this type gets a dedicated sheet.
 * The employer block, the pay period and the net-pay figure are the parts an
 * employee (and สปส./สรรพากร) actually read.
 */
export function PayslipTemplate({ doc, t }: TemplateProps) {
  const accent = doc.accentColor ?? '#11836E'
  const earnings = doc.lines.filter((line) => line.amount >= 0)
  const deductions = doc.lines.filter((line) => line.amount < 0)
  const totalEarnings = earnings.reduce((sum, line) => sum + line.amount, 0)
  const totalDeductions = deductions.reduce((sum, line) => sum + Math.abs(line.amount), 0)

  return (
    <div className="flex flex-col gap-4 text-sm leading-6">
      <header className="flex items-start justify-between gap-6 border-b pb-3">
        <div className="flex items-start gap-3">
          {doc.logoHeader ? (
            // eslint-disable-next-line @next/next/no-img-element -- data URI from settings
            <img src={doc.logoHeader} alt="" className="h-14 w-auto object-contain" />
          ) : null}
          <div>
            <div className="text-base font-semibold">{doc.seller.legalName || doc.seller.name}</div>
            {doc.seller.address ? <div className="text-xs text-muted-foreground">{doc.seller.address}</div> : null}
            {doc.seller.phone || doc.seller.email ? (
              <div className="text-xs text-muted-foreground">{[doc.seller.phone, doc.seller.email].filter(Boolean).join(' · ')}</div>
            ) : null}
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold" style={{ color: accent }}>{doc.headingTh}</div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{doc.headingEn}</div>
          <div className="mt-1 text-xs">
            {t('orva_documents.payslip.period', 'งวดเงินเดือน')}: <span className="font-medium">{doc.secondaryDate ?? '—'}</span>
          </div>
          <div className="text-xs">
            {t('orva_documents.payslip.payDate', 'วันที่จ่าย')}: {doc.issueDate ? formatThaiDate(doc.issueDate) : '—'}
          </div>
          <div className="text-xs text-muted-foreground">{t('orva_documents.field.number', 'เลขที่')} {doc.number}</div>
        </div>
      </header>

      <section className="rounded border px-3 py-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('orva_documents.payslip.employee', 'พนักงาน')}
        </div>
        <div className="text-sm font-semibold">{doc.buyer.name}</div>
        {doc.buyer.address ? <div className="text-xs text-muted-foreground">{doc.buyer.address}</div> : null}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded border">
          <div className="border-b px-3 py-2 text-xs font-semibold text-white" style={{ backgroundColor: accent }}>
            {t('orva_documents.payslip.earnings', 'รายได้')}
          </div>
          <table className="w-full">
            <tbody>
              {earnings.map((line, index) => (
                <tr key={index} className="border-b last:border-b-0">
                  <td className="px-3 py-1.5">{line.description}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(line.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/30 font-semibold">
                <td className="px-3 py-1.5">{t('orva_documents.payslip.totalEarnings', 'รวมรายได้')}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(totalEarnings)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="rounded border">
          <div className="border-b px-3 py-2 text-xs font-semibold text-white" style={{ backgroundColor: accent }}>
            {t('orva_documents.payslip.deductions', 'รายการหัก')}
          </div>
          <table className="w-full">
            <tbody>
              {deductions.length === 0 ? (
                <tr><td className="px-3 py-1.5 text-muted-foreground" colSpan={2}>{t('orva_documents.payslip.noDeductions', 'ไม่มีรายการหัก')}</td></tr>
              ) : deductions.map((line, index) => (
                <tr key={index} className="border-b last:border-b-0">
                  <td className="px-3 py-1.5">{line.description}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(Math.abs(line.amount))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/30 font-semibold">
                <td className="px-3 py-1.5">{t('orva_documents.payslip.totalDeductions', 'รวมรายการหัก')}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(totalDeductions)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="flex items-center justify-between rounded px-4 py-3 text-white" style={{ backgroundColor: accent }}>
        <span className="text-sm font-semibold">{t('orva_documents.payslip.net', 'เงินได้สุทธิที่ได้รับ')}</span>
        <span className="text-lg font-bold tabular-nums">{formatMoney(doc.grandTotal)} {doc.currencyCode}</span>
      </section>

      {doc.amountInWords ? (
        <div className="rounded border bg-muted/20 px-3 py-2 text-xs">
          <span className="text-muted-foreground">{t('orva_documents.field.amountInWords', 'จำนวนเงินเป็นตัวอักษร')}: </span>
          <span className="font-medium">{doc.amountInWords}</span>
        </div>
      ) : null}

      <div className="mt-2 grid grid-cols-2 gap-8 pt-6 text-center text-xs">
        <div>
          <div className="mx-auto w-48 border-t pt-1">{t('orva_documents.payslip.employeeSign', 'ลงชื่อพนักงาน')}</div>
        </div>
        <div>
          <div className="mx-auto w-48 border-t pt-1">{t('orva_documents.payslip.employerSign', 'ผู้มีอำนาจลงนาม')}</div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {t('orva_documents.payslip.confidential', 'เอกสารนี้เป็นข้อมูลส่วนบุคคล กรุณาเก็บรักษาเป็นความลับ')}
      </p>
    </div>
  )
}

export default PayslipTemplate
