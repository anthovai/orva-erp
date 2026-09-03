"use client"
import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type Party = { name: string; taxId: string | null; branch: string | null; address: string | null }
type Cert = { certNo: string | null; form: string; payer: Party; payee: Party; paymentDate: string; incomeType: string | null; rate: string | null; amountPaid: string; taxWithheld: string; paymentNo: string | null }

const fmt = (v: string | number) => Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const thaiDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  const months = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear() + 543}`
}
const digits13 = (id: string | null) => (id ? id.replace(/\D/g, '').padEnd(13, ' ').slice(0, 13).split('') : Array(13).fill(' '))

function IdBoxes({ id }: { id: string | null }) {
  return (
    <span className="inline-flex gap-0.5 align-middle">
      {digits13(id).map((c, i) => (
        <span key={i} className={`inline-flex h-6 w-5 items-center justify-center border text-xs tabular-nums ${[0, 4, 9, 11].includes(i) ? 'ml-1' : ''}`}>{c.trim()}</span>
      ))}
    </span>
  )
}

/**
 * หนังสือรับรองการหักภาษี ณ ที่จ่าย ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร —
 * the certificate a payer must give the payee for each withholding. Layout
 * follows the Revenue Department form: payer, payee, form type (ภ.ง.ด.3/53),
 * income table, totals in figures and words, condition, signature.
 */
export default function WhtCertificate() {
  const t = useT()
  const params = useSearchParams()
  const paymentId = params.get('paymentId')
  const { data, error } = useQuery({
    queryKey: ['orva_finance.wht.cert', paymentId],
    queryFn: async () => readApiResultOrThrow<Cert>(`/api/orva_finance/reports/wht/certificate?paymentId=${paymentId}`),
    enabled: Boolean(paymentId),
  })

  return (
    <Page>
      <PageHeader
        title={t('orva_finance.whtCert.page.title', 'หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ)')}
        actions={<Button variant="outline" className="print:hidden" onClick={() => window.print()} disabled={!data}>{t('orva_finance.reports.print', 'พิมพ์')}</Button>}
      />
      <PageBody>
        {!paymentId ? <p className="text-sm text-muted-foreground">{t('orva_finance.whtCert.pick', 'เปิดจากรายการจ่ายเงินที่มีการหักภาษี ณ ที่จ่าย')}</p> : null}
        {error ? <p className="text-sm text-destructive">{String(error)}</p> : null}
        {data ? (
          <div className="flex justify-center">
            <div data-document-sheet="true" className="w-[794px] max-w-full bg-card p-10 text-sm shadow-sm print:w-full print:p-0 print:shadow-none">
              <div className="flex items-start justify-between">
                <div className="text-xs">{t('orva_finance.whtCert.copy', 'ฉบับที่ 1 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย ใช้แนบพร้อมกับแบบแสดงรายการภาษี)')}</div>
                <div className="text-right text-xs">{t('orva_finance.whtCert.no', 'เลขที่')} <span className="font-semibold">{data.certNo ?? '—'}</span></div>
              </div>
              <h1 className="mt-2 text-center text-lg font-bold">หนังสือรับรองการหักภาษี ณ ที่จ่าย</h1>
              <p className="text-center text-xs">ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร</p>

              <div className="mt-4 rounded border p-3">
                <div className="font-semibold">ผู้มีหน้าที่หักภาษี ณ ที่จ่าย</div>
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <span>{data.payer.name}</span>
                  <span className="text-xs">เลขประจำตัวผู้เสียภาษีอากร</span><IdBoxes id={data.payer.taxId} />
                  {data.payer.branch ? <span className="text-xs">({data.payer.branch})</span> : null}
                </div>
                <div className="mt-1 text-xs">ที่อยู่ {data.payer.address ?? '—'}</div>
              </div>
              <div className="mt-2 rounded border p-3">
                <div className="font-semibold">ผู้ถูกหักภาษี ณ ที่จ่าย</div>
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <span>{data.payee.name}</span>
                  <span className="text-xs">เลขประจำตัวผู้เสียภาษีอากร</span><IdBoxes id={data.payee.taxId} />
                </div>
                <div className="mt-1 text-xs">ที่อยู่ {data.payee.address ?? '—'}</div>
                <div className="mt-2 flex flex-wrap gap-4 text-xs">
                  <span>ลำดับที่ <span className="font-semibold">{data.certNo?.replace(/\D/g, '').replace(/^0+/, '') || '—'}</span> ในแบบ</span>
                  {['ภ.ง.ด.1ก', 'ภ.ง.ด.2', 'ภ.ง.ด.3', 'ภ.ง.ด.53'].map((f) => (
                    <span key={f}>
                      <span className={`mr-1 inline-block h-3 w-3 border align-middle ${(f === 'ภ.ง.ด.53' && data.form === 'PND53') || (f === 'ภ.ง.ด.3' && data.form === 'PND3') ? 'bg-foreground' : ''}`} /> {f}
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
                  <tr className="border-b">
                    <td className="px-2 py-2">6. อื่น ๆ (ระบุ) {data.incomeType ?? 'ค่าบริการ'} {data.rate ? `— หัก ${Number(data.rate)}%` : ''}</td>
                    <td className="px-2 py-2 text-right">{thaiDate(data.paymentDate)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmt(data.amountPaid)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmt(data.taxWithheld)}</td>
                  </tr>
                  <tr className="font-semibold">
                    <td className="px-2 py-2 text-right" colSpan={2}>รวมเงินที่จ่ายและภาษีที่หักนำส่ง</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmt(data.amountPaid)}</td>
                    <td className="px-2 py-2 text-right tabular-nums"><span className="orva-ledger-total">{fmt(data.taxWithheld)}</span></td>
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
                  <div className="mt-1">{thaiDate(data.paymentDate)}</div>
                  <div className="mt-1 text-muted-foreground">(ประทับตรานิติบุคคล ถ้ามี)</div>
                </div>
              </div>
              <p className="mt-6 text-xs text-muted-foreground">อ้างอิงรายการจ่าย {data.paymentNo ?? '—'}</p>
            </div>
          </div>
        ) : null}
      </PageBody>
    </Page>
  )
}
