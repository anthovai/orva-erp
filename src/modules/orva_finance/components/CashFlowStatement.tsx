"use client"
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type Line = { code: string; name: string; amount: string }
type CashFlow = {
  from: string; to: string; netProfit: string
  operating: Line[]; investing: Line[]; financing: Line[]
  totalOperating: string; totalInvesting: string; totalFinancing: string
  netChange: string; openingCash: string; closingCash: string; reconciled: boolean
}
const fmt = (v: string | number) => Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** งบกระแสเงินสด (วิธีทางอ้อม) */
export default function CashFlowStatement() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [from, setFrom] = React.useState(() => new Date().toISOString().slice(0, 4) + '-01-01')
  const [to, setTo] = React.useState(() => new Date().toISOString().slice(0, 10))
  const { data, isLoading, error } = useQuery({
    queryKey: ['orva_finance.reports.cashflow', from, to, scopeVersion],
    queryFn: async () => readApiResultOrThrow<CashFlow>(`/api/orva_finance/gl/reports/cash-flow?from=${from}&to=${to}`),
    enabled: Boolean(from && to),
  })
  const Section = ({ title, lines, total, lead }: { title: string; lines: Line[]; total: string; lead?: { label: string; amount: string } }) => (
    <tbody>
      <tr className="bg-muted/40"><td className="px-3 py-2 font-semibold" colSpan={2}>{title}</td></tr>
      {lead ? <tr className="border-b"><td className="px-3 py-1 pl-6">{lead.label}</td><td className="px-3 py-1 text-right tabular-nums">{fmt(lead.amount)}</td></tr> : null}
      {lines.map((l) => (
        <tr key={l.code} className="border-b"><td className="px-3 py-1 pl-6">{l.code} · {l.name}</td><td className="px-3 py-1 text-right tabular-nums">{fmt(l.amount)}</td></tr>
      ))}
      <tr className="border-b font-semibold"><td className="px-3 py-2">{t('orva_finance.cashflow.total', 'รวม')} {title}</td><td className="px-3 py-2 text-right tabular-nums">{fmt(total)}</td></tr>
    </tbody>
  )
  return (
    <Page>
      <PageHeader
        title={t('orva_finance.cashflow.page.title', 'งบกระแสเงินสด')}
        actions={(
          <div className="flex items-center gap-2 print:hidden">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
            <Button variant="outline" onClick={() => window.print()} disabled={!data}>{t('orva_finance.reports.print', 'พิมพ์')}</Button>
          </div>
        )}
      />
      <PageBody>
        {error ? <div className="text-sm text-destructive">{String(error)}</div> : null}
        {isLoading ? <div className="py-8 text-center text-sm text-muted-foreground">…</div> : null}
        {data ? (
          <div className="max-w-3xl">
            <p className="mb-2 text-xs text-muted-foreground">{t('orva_finance.cashflow.method', 'วิธีทางอ้อม — เริ่มจากกำไรสุทธิ ปรับด้วยรายการไม่ใช่เงินสดและการเปลี่ยนแปลงเงินทุนหมุนเวียน')} · {data.from} → {data.to}</p>
            <table className="w-full rounded-md border text-sm">
              <Section title={t('orva_finance.cashflow.operating', 'กระแสเงินสดจากกิจกรรมดำเนินงาน')} lines={data.operating} total={data.totalOperating} lead={{ label: t('orva_finance.cashflow.netProfit', 'กำไร (ขาดทุน) สุทธิ'), amount: data.netProfit }} />
              <Section title={t('orva_finance.cashflow.investing', 'กระแสเงินสดจากกิจกรรมลงทุน')} lines={data.investing} total={data.totalInvesting} />
              <Section title={t('orva_finance.cashflow.financing', 'กระแสเงินสดจากกิจกรรมจัดหาเงิน')} lines={data.financing} total={data.totalFinancing} />
              <tbody>
                <tr className="bg-muted/40 font-semibold"><td className="px-3 py-2">{t('orva_finance.cashflow.netChange', 'เงินสดเพิ่มขึ้น (ลดลง) สุทธิ')}</td><td className="px-3 py-2 text-right tabular-nums">{fmt(data.netChange)}</td></tr>
                <tr className="border-b"><td className="px-3 py-1">{t('orva_finance.cashflow.opening', 'เงินสดและเงินฝากธนาคารต้นงวด')}</td><td className="px-3 py-1 text-right tabular-nums">{fmt(data.openingCash)}</td></tr>
                <tr className="font-semibold"><td className="px-3 py-2">{t('orva_finance.cashflow.closing', 'เงินสดและเงินฝากธนาคารปลายงวด')}</td><td className="px-3 py-2 text-right tabular-nums"><span className="orva-ledger-total">{fmt(data.closingCash)}</span></td></tr>
              </tbody>
            </table>
            <p className={`mt-2 text-xs ${data.reconciled ? 'text-muted-foreground' : 'text-destructive'}`}>
              {data.reconciled ? t('orva_finance.cashflow.reconciled', 'กระทบยอดกับบัญชีเงินสด/ธนาคารตรงกัน') : t('orva_finance.cashflow.notReconciled', 'ยอดไม่ตรงกับบัญชีเงินสด — ตรวจการจัดประเภทบัญชี')}
            </p>
          </div>
        ) : null}
      </PageBody>
    </Page>
  )
}
