"use client"
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type SalesRow = { date: string; document_no: string; customer_name: string | null; customer_tax_id: string | null; customer_branch: string | null; base: string; vat: string; total: string }
type PurchaseRow = { date: string; document_no: string; vendor_ref: string | null; vendor_name: string | null; vendor_tax_id: string | null; base: string; vat: string; total: string }
type VatResponse = {
  month: string
  sales: SalesRow[]
  purchases: PurchaseRow[]
  summary: { outputBase: string; outputVat: string; inputBase: string; inputVat: string; netPayable: string }
}

const fmt = (v: string | number) => Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const thisMonth = () => new Date().toISOString().slice(0, 7)

/**
 * รายงานภาษีขาย / ภาษีซื้อ + สรุป ภ.พ.30 for one month — the registers the
 * Revenue Department expects a VAT registrant to keep, printable as-is.
 */
export default function VatReport() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [month, setMonth] = React.useState(thisMonth())
  const { data, isLoading, error } = useQuery({
    queryKey: ['orva_finance.reports.vat', month, scopeVersion],
    queryFn: async () => readApiResultOrThrow<VatResponse>(`/api/orva_finance/reports/vat?month=${month}`),
    enabled: /^\d{4}-\d{2}$/.test(month),
  })
  const net = Number(data?.summary.netPayable ?? 0)

  return (
    <Page>
      <PageHeader
        title={t('orva_finance.vat.page.title', 'รายงานภาษีมูลค่าเพิ่ม (ภ.พ.30)')}
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
              <h2 className="mb-2 text-base font-semibold">{t('orva_finance.vat.sales.title', 'รายงานภาษีขาย')} — {data.month}</h2>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left">
                      <th className="px-3 py-2">{t('orva_finance.vat.column.date', 'วันที่')}</th>
                      <th className="px-3 py-2">{t('orva_finance.vat.column.taxInvoice', 'เลขที่ใบกำกับภาษี')}</th>
                      <th className="px-3 py-2">{t('orva_finance.vat.column.customer', 'ชื่อผู้ซื้อ')}</th>
                      <th className="px-3 py-2">{t('orva_finance.vat.column.taxId', 'เลขประจำตัวผู้เสียภาษี')}</th>
                      <th className="px-3 py-2">{t('orva_finance.vat.column.branch', 'สถานประกอบการ')}</th>
                      <th className="px-3 py-2 text-right">{t('orva_finance.vat.column.base', 'มูลค่าสินค้า/บริการ')}</th>
                      <th className="px-3 py-2 text-right">{t('orva_finance.vat.column.vat', 'ภาษีมูลค่าเพิ่ม')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sales.length === 0 ? (
                      <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">{t('orva_finance.vat.sales.empty', 'ไม่มีใบกำกับภาษีขายในเดือนนี้')}</td></tr>
                    ) : data.sales.map((r) => (
                      <tr key={r.document_no} className="border-b last:border-b-0">
                        <td className="px-3 py-2">{r.date}</td>
                        <td className="px-3 py-2 font-medium">{r.document_no}</td>
                        <td className="px-3 py-2">{r.customer_name ?? '—'}</td>
                        <td className="px-3 py-2 tabular-nums">{r.customer_tax_id ?? '—'}</td>
                        <td className="px-3 py-2">{r.customer_branch ?? '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(r.base)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(r.vat)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/30 font-semibold">
                      <td className="px-3 py-2" colSpan={5}>{t('orva_finance.vat.total', 'รวม')}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(data.summary.outputBase)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(data.summary.outputVat)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>

            <section>
              <h2 className="mb-2 text-base font-semibold">{t('orva_finance.vat.purchases.title', 'รายงานภาษีซื้อ')} — {data.month}</h2>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left">
                      <th className="px-3 py-2">{t('orva_finance.vat.column.date', 'วันที่')}</th>
                      <th className="px-3 py-2">{t('orva_finance.vat.column.billNo', 'เลขที่บิล / ใบกำกับผู้ขาย')}</th>
                      <th className="px-3 py-2">{t('orva_finance.vat.column.vendor', 'ชื่อผู้ขาย')}</th>
                      <th className="px-3 py-2">{t('orva_finance.vat.column.taxId', 'เลขประจำตัวผู้เสียภาษี')}</th>
                      <th className="px-3 py-2 text-right">{t('orva_finance.vat.column.base', 'มูลค่าสินค้า/บริการ')}</th>
                      <th className="px-3 py-2 text-right">{t('orva_finance.vat.column.vat', 'ภาษีมูลค่าเพิ่ม')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.purchases.length === 0 ? (
                      <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">{t('orva_finance.vat.purchases.empty', 'ไม่มีภาษีซื้อในเดือนนี้')}</td></tr>
                    ) : data.purchases.map((r, i) => (
                      <tr key={`${r.document_no}-${i}`} className="border-b last:border-b-0">
                        <td className="px-3 py-2">{r.date}</td>
                        <td className="px-3 py-2 font-medium">{r.document_no}{r.vendor_ref ? ` / ${r.vendor_ref}` : ''}</td>
                        <td className="px-3 py-2">{r.vendor_name ?? '—'}</td>
                        <td className="px-3 py-2 tabular-nums">{r.vendor_tax_id ?? '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(r.base)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(r.vat)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/30 font-semibold">
                      <td className="px-3 py-2" colSpan={4}>{t('orva_finance.vat.total', 'รวม')}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(data.summary.inputBase)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(data.summary.inputVat)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>

            <section className="max-w-md rounded-md border p-4 text-sm">
              <h2 className="mb-2 text-base font-semibold">{t('orva_finance.vat.summary.title', 'สรุป ภ.พ.30')}</h2>
              <dl className="grid grid-cols-2 gap-y-1">
                <dt className="text-muted-foreground">{t('orva_finance.vat.summary.output', 'ภาษีขาย')}</dt>
                <dd className="text-right tabular-nums">{fmt(data.summary.outputVat)}</dd>
                <dt className="text-muted-foreground">{t('orva_finance.vat.summary.input', 'ภาษีซื้อ')}</dt>
                <dd className="text-right tabular-nums">{fmt(data.summary.inputVat)}</dd>
                <dt className="font-semibold">
                  {net >= 0
                    ? t('orva_finance.vat.summary.payable', 'ภาษีที่ต้องชำระ')
                    : t('orva_finance.vat.summary.excess', 'ภาษีชำระเกิน (ยกไปเดือนถัดไป)')}
                </dt>
                <dd className="text-right font-semibold tabular-nums"><span className="orva-ledger-total">{fmt(Math.abs(net))}</span></dd>
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">
                {t('orva_finance.vat.summary.hint', 'ยื่นแบบ ภ.พ.30 และชำระภายในวันที่ 15 ของเดือนถัดไป (ยื่นออนไลน์ +8 วัน) จุดความรับผิดของค่าบริการคือวันที่รับชำระ')}
              </p>
            </section>
          </div>
        ) : null}
      </PageBody>
    </Page>
  )
}
