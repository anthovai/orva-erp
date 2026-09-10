"use client"
import * as React from 'react'

/**
 * หนังสือรับรองการหักภาษี ณ ที่จ่าย ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร.
 *
 * The sheet itself, with no idea where its figures came from. Two callers
 * feed it: a vendor payment (ภ.ง.ด.3/53, one line, the payment date) and an
 * employee's year of payroll (ภ.ง.ด.1ก, one line per month, income type
 * 40(1)). It is the same government form in both cases, so it is one
 * component rather than two that drift.
 */

export type CertificateParty = { name: string; taxId: string | null; branch: string | null; address: string | null }
export type CertificateFormCode = 'PND1A' | 'PND2' | 'PND3' | 'PND53'
export type CertificateRow = { label: string; date: string; amount: number; tax: number }

const fmt = (v: number) => Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']

export function thaiDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`
}

const digits13 = (id: string | null) => (id ? id.replace(/\D/g, '').padEnd(13, ' ').slice(0, 13).split('') : Array(13).fill(' '))

export function IdBoxes({ id }: { id: string | null }) {
  return (
    <span className="inline-flex gap-0.5 align-middle">
      {digits13(id).map((c, i) => (
        <span key={i} className={`inline-flex h-6 w-5 items-center justify-center border text-xs tabular-nums ${[0, 4, 9, 11].includes(i) ? 'ml-1' : ''}`}>{c.trim()}</span>
      ))}
    </span>
  )
}

const FORM_LABELS: Array<{ code: CertificateFormCode; label: string }> = [
  { code: 'PND1A', label: 'ภ.ง.ด.1ก' },
  { code: 'PND2', label: 'ภ.ง.ด.2' },
  { code: 'PND3', label: 'ภ.ง.ด.3' },
  { code: 'PND53', label: 'ภ.ง.ด.53' },
]

export type WhtCertificateSheetProps = {
  copyLabel: string
  certNo: string | null
  /** Which return this withholding is reported on; ticks that box on the form. */
  form: CertificateFormCode
  payer: CertificateParty
  payee: CertificateParty
  /** The number printed as "ลำดับที่ … ในแบบ". */
  seqInForm?: string | null
  rows: CertificateRow[]
  signatureDate: string
  /** A reference line under the sheet, e.g. which payment this came from. */
  footnote?: string | null
}

export function WhtCertificateSheet({ copyLabel, certNo, form, payer, payee, seqInForm, rows, signatureDate, footnote }: WhtCertificateSheetProps) {
  const totalAmount = rows.reduce((sum, r) => sum + r.amount, 0)
  const totalTax = rows.reduce((sum, r) => sum + r.tax, 0)
  return (
    <div data-document-sheet="true" className="w-[794px] max-w-full bg-card p-10 text-sm shadow-sm print:w-full print:p-0 print:shadow-none">
      <div className="flex items-start justify-between">
        <div className="text-xs">{copyLabel}</div>
        <div className="text-right text-xs">เลขที่ <span className="font-semibold">{certNo ?? '—'}</span></div>
      </div>
      <h1 className="mt-2 text-center text-lg font-bold">หนังสือรับรองการหักภาษี ณ ที่จ่าย</h1>
      <p className="text-center text-xs">ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร</p>

      <div className="mt-4 rounded border p-3">
        <div className="font-semibold">ผู้มีหน้าที่หักภาษี ณ ที่จ่าย</div>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <span>{payer.name}</span>
          <span className="text-xs">เลขประจำตัวผู้เสียภาษีอากร</span><IdBoxes id={payer.taxId} />
          {payer.branch ? <span className="text-xs">({payer.branch})</span> : null}
        </div>
        <div className="mt-1 text-xs">ที่อยู่ {payer.address ?? '—'}</div>
      </div>
      <div className="mt-2 rounded border p-3">
        <div className="font-semibold">ผู้ถูกหักภาษี ณ ที่จ่าย</div>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <span>{payee.name}</span>
          <span className="text-xs">เลขประจำตัวผู้เสียภาษีอากร</span><IdBoxes id={payee.taxId} />
        </div>
        <div className="mt-1 text-xs">ที่อยู่ {payee.address ?? '—'}</div>
        <div className="mt-2 flex flex-wrap gap-4 text-xs">
          <span>ลำดับที่ <span className="font-semibold">{seqInForm || '—'}</span> ในแบบ</span>
          {FORM_LABELS.map((f) => (
            <span key={f.code}>
              <span className={`mr-1 inline-block h-3 w-3 border align-middle ${form === f.code ? 'bg-foreground' : ''}`} /> {f.label}
            </span>
          ))}
        </div>
      </div>

      <table className="mt-4 w-full border text-xs">
        <thead>
          <tr className="border-b bg-muted/40">
            <th className="px-2 py-2 text-left">ประเภทเงินได้พึงประเมินที่จ่าย</th>
            <th className="w-32 px-2 py-2 text-right">วัน เดือน ปี ที่จ่าย</th>
            <th className="w-32 px-2 py-2 text-right">จำนวนเงินที่จ่าย</th>
            <th className="w-28 px-2 py-2 text-right">ภาษีที่หักและนำส่งไว้</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.label}-${row.date}-${index}`} className="border-b">
              <td className="px-2 py-2">{row.label}</td>
              <td className="px-2 py-2 text-right">{thaiDate(row.date)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmt(row.amount)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmt(row.tax)}</td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="px-2 py-2 text-right" colSpan={2}>รวมเงินที่จ่ายและภาษีที่หักนำส่ง</td>
            <td className="px-2 py-2 text-right tabular-nums">{fmt(totalAmount)}</td>
            <td className="px-2 py-2 text-right tabular-nums"><span className="orva-ledger-total">{fmt(totalTax)}</span></td>
          </tr>
        </tbody>
      </table>

      <div className="mt-3 text-xs">
        <div>ผู้จ่ายเงิน <span className="mr-1 inline-block h-3 w-3 border bg-foreground align-middle" /> (1) หัก ณ ที่จ่าย <span className="mx-1 inline-block h-3 w-3 border align-middle" /> (2) ออกให้ตลอดไป <span className="mx-1 inline-block h-3 w-3 border align-middle" /> (3) ออกให้ครั้งเดียว</div>
        <div className="mt-2">ขอรับรองว่าข้อความและตัวเลขดังกล่าวข้างต้นถูกต้องตรงกับความจริงทุกประการ</div>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-8 text-center text-xs">
        <div />
        <div>
          <div className="mx-6 border-b border-foreground pb-8" />
          <div className="mt-1">ลงชื่อ ผู้จ่ายเงิน</div>
          <div className="mt-1">{thaiDate(signatureDate)}</div>
          <div className="mt-1 text-muted-foreground">(ประทับตรานิติบุคคล ถ้ามี)</div>
        </div>
      </div>
      {footnote ? <p className="mt-6 text-xs text-muted-foreground">{footnote}</p> : null}
    </div>
  )
}

export default WhtCertificateSheet
