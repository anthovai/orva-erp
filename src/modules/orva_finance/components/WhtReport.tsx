"use client"
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type ByUsRow = { date: string; payment_no: string | null; cert_no: string | null; vendor_name: string | null; vendor_tax_id: string | null; income_type: string | null; rate: string | null; base: string; wht: string }
type FromUsRow = { date: string; receipt_no: string | null; invoice_no: string | null; customer_name: string | null; rate: string | null; base: string; wht: string }
type WhtResponse = { month: string; withheldByUs: ByUsRow[]; withheldFromUs: FromUsRow[]; summary: { payable: string; receivable: string } }

const fmt = (v: string | number) => Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const thisMonth = () => new Date().toISOString().slice(0, 7)

/**
 * ภาษีหัก ณ ที่จ่าย, both directions: what we withheld from vendors (the
 * ภ.ง.ด.3/53 list, each line a 50 ทวิ certificate) and what customers
 * withheld from us (credit against corporate income tax).
 */
export default function WhtReport() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [month, setMonth] = React.useState(thisMonth())
  const { data, isLoading, error } = useQuery({
    queryKey: ['orva_finance.reports.wht', month, scopeVersion],
    queryFn: async () => readApiResultOrThrow<WhtResponse>(`/api/orva_finance/reports/wht?month=${month}`),
    enabled: /^\d{4}-\d{2}$/.test(month),
  })

  return (
    <Page>
      <PageHeader
        title={t('orva_finance.wht.page.title', 'ภาษีหัก ณ ที่จ่าย (ภ.ง.ด.3/53)')}
        actions={(
          <div className="flex items-center gap-2 print:hidden">
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44" />
            <Button variant="outline" onClick={() => window.print()} disabled={!data}>
              {t('orva_finance.reports.print', 'พิมพ์')}
            </Button>
          </div>
        )}
      />
      <PageBody>
        {error ? <div className="text-sm text-destructive">{String(error)}</div> : null}
        {isLoading ? <div className="py-8 text-center text-sm text-muted-foreground">…</div> : null}
        {data ? (
          <div className="flex flex-col gap-8">
            <section>
              <h2 className="mb-1 text-base font-semibold">{t('orva_finance.wht.byUs.title', 'ที่เราหักจากผู้รับเงิน — นำส่ง ภ.ง.ด.3/53')} — {data.month}</h2>
              <p className="mb-2 text-xs text-muted-foreground">{t('orva_finance.wht.byUs.hint', 'นำส่งภายในวันที่ 7 ของเดือนถัดไป (ยื่นออนไลน์ +8 วัน) พร้อมออกหนังสือรับรอง 50 ทวิ ให้ผู้รับเงิน')}</p>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left">
                      <th className="px-3 py-2">{t('orva_finance.vat.column.date', 'วันที่')}</th>
                      <th className="px-3 py-2">{t('orva_finance.wht.column.cert', 'เลขที่หนังสือรับรอง')}</th>
                      <th className="px-3 py-2">{t('orva_finance.wht.column.payee', 'ผู้รับเงิน')}</th>
                      <th className="px-3 py-2">{t('orva_finance.vat.column.taxId', 'เลขประจำตัวผู้เสียภาษี')}</th>
                      <th className="px-3 py-2">{t('orva_finance.wht.column.incomeType', 'ประเภทเงินได้')}</th>
                      <th className="px-3 py-2 text-right">{t('orva_finance.wht.column.base', 'จำนวนเงินที่จ่าย')}</th>
                      <th className="px-3 py-2 text-right">{t('orva_finance.wht.column.rate', 'อัตรา')}</th>
                      <th className="px-3 py-2 text-right">{t('orva_finance.wht.column.wht', 'ภาษีที่หัก')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.withheldByUs.length === 0 ? (
                      <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">{t('orva_finance.wht.byUs.empty', 'ไม่มีการหักภาษี ณ ที่จ่ายในเดือนนี้')}</td></tr>
                    ) : data.withheldByUs.map((r, i) => (
                      <tr key={`${r.payment_no}-${i}`} className="border-b last:border-b-0">
                        <td className="px-3 py-2">{r.date}</td>
                        <td className="px-3 py-2 font-medium">{r.cert_no ?? r.payment_no ?? '—'}</td>
                        <td className="px-3 py-2">{r.vendor_name ?? '—'}</td>
                        <td className="px-3 py-2 tabular-nums">{r.vendor_tax_id ?? '—'}</td>
                        <td className="px-3 py-2">{r.income_type ?? '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(r.base)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.rate ? `${Number(r.rate)}%` : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(r.wht)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/30 font-semibold">
                      <td className="px-3 py-2" colSpan={7}>{t('orva_finance.wht.total.payable', 'รวมภาษีที่ต้องนำส่ง')}</td>
                      <td className="px-3 py-2 text-right tabular-nums"><span className="orva-ledger-total">{fmt(data.summary.payable)}</span></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>

            <section>
              <h2 className="mb-1 text-base font-semibold">{t('orva_finance.wht.fromUs.title', 'ที่ลูกค้าหักจากเรา — เครดิตภาษีเงินได้นิติบุคคล')} — {data.month}</h2>
              <p className="mb-2 text-xs text-muted-foreground">{t('orva_finance.wht.fromUs.hint', 'เก็บหนังสือรับรอง 50 ทวิ ที่ลูกค้าออกให้ เพื่อใช้เครดิตใน ภ.ง.ด.50/51')}</p>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left">
                      <th className="px-3 py-2">{t('orva_finance.vat.column.date', 'วันที่')}</th>
                      <th className="px-3 py-2">{t('orva_finance.wht.column.receipt', 'ใบเสร็จ')}</th>
                      <th className="px-3 py-2">{t('orva_finance.wht.column.invoice', 'ใบแจ้งหนี้')}</th>
                      <th className="px-3 py-2">{t('orva_finance.vat.column.customer', 'ชื่อผู้ซื้อ')}</th>
                      <th className="px-3 py-2 text-right">{t('orva_finance.wht.column.settled', 'ยอดที่ชำระ')}</th>
                      <th className="px-3 py-2 text-right">{t('orva_finance.wht.column.rate', 'อัตรา')}</th>
                      <th className="px-3 py-2 text-right">{t('orva_finance.wht.column.whtFromUs', 'ภาษีที่ถูกหัก')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.withheldFromUs.length === 0 ? (
                      <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">{t('orva_finance.wht.fromUs.empty', 'ไม่มีรายการถูกหักภาษีในเดือนนี้')}</td></tr>
                    ) : data.withheldFromUs.map((r, i) => (
                      <tr key={`${r.receipt_no}-${i}`} className="border-b last:border-b-0">
                        <td className="px-3 py-2">{r.date}</td>
                        <td className="px-3 py-2 font-medium">{r.receipt_no ?? '—'}</td>
                        <td className="px-3 py-2">{r.invoice_no ?? '—'}</td>
                        <td className="px-3 py-2">{r.customer_name ?? '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(r.base)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.rate ? `${Number(r.rate)}%` : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(r.wht)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/30 font-semibold">
                      <td className="px-3 py-2" colSpan={6}>{t('orva_finance.wht.total.receivable', 'รวมภาษีถูกหัก (เครดิต)')}</td>
                      <td className="px-3 py-2 text-right tabular-nums"><span className="orva-ledger-total">{fmt(data.summary.receivable)}</span></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          </div>
        ) : null}
      </PageBody>
    </Page>
  )
}
