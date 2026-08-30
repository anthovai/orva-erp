"use client"
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Input } from '@open-mercato/ui/primitives/input'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type Row = { accountId: string; code: string; name: string; balance: string }

type StatementsResponse = {
  pl: {
    income: Row[]
    expense: Row[]
    totalIncome: string
    totalExpense: string
    netProfit: string
  }
  balanceSheet: {
    asset: Row[]
    liability: Row[]
    equity: Row[]
    currentEarnings: string
    totalAssets: string
    totalLiabilities: string
    totalEquity: string
    totalLiabilitiesAndEquity: string
    balanced: boolean
  }
}

const fmt = (v: string | number) =>
  Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function Section({ title, rows, total, totalLabel, extraRows }: {
  title: string
  rows: Row[]
  total: string
  totalLabel: string
  extraRows?: Array<{ label: string; value: string }>
}) {
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <table className="w-full text-sm">
        <tbody>
          {rows.length === 0 && !extraRows?.length ? (
            <tr><td className="py-1 text-muted-foreground">—</td></tr>
          ) : rows.map((row) => (
            <tr key={row.accountId} className="border-b border-dashed last:border-b-0">
              <td className="py-1 pr-2 text-muted-foreground w-16">{row.code}</td>
              <td className="py-1">{row.name}</td>
              <td className="py-1 text-right tabular-nums">{fmt(row.balance)}</td>
            </tr>
          ))}
          {extraRows?.map((row) => (
            <tr key={row.label} className="border-b border-dashed last:border-b-0">
              <td className="py-1 pr-2 w-16"></td>
              <td className="py-1 italic">{row.label}</td>
              <td className="py-1 text-right tabular-nums italic">{fmt(row.value)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t font-semibold">
            <td className="py-1" colSpan={2}>{totalLabel}</td>
            <td className="py-1 text-right tabular-nums">{fmt(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

export default function FinancialStatements() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const today = React.useMemo(() => new Date().toISOString().slice(0, 10), [])
  const [from, setFrom] = React.useState(() => `${today.slice(0, 8)}01`)
  const [to, setTo] = React.useState(today)

  const { data, isLoading, error } = useQuery({
    queryKey: ['orva_finance.statements', from, to, scopeVersion],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      const qs = params.toString()
      return readApiResultOrThrow<StatementsResponse>(`/api/orva_finance/gl/reports/statements${qs ? `?${qs}` : ''}`)
    },
  })

  const netPositive = Number(data?.pl.netProfit ?? 0) >= 0

  return (
    <Page>
      <PageHeader
        title={t('orva_finance.statements.page.title', 'Financial Statements')}
        actions={(
          <div className="flex items-center gap-2 text-sm">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-muted-foreground">→</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        )}
      />
      <PageBody>
        {error ? (
          <div className="text-sm text-destructive">{t('orva_finance.statements.error', 'Failed to load statements')}</div>
        ) : isLoading || !data ? (
          <div className="text-sm text-muted-foreground">…</div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-md border p-4 flex flex-col gap-4">
              <div>
                <h2 className="text-base font-semibold">{t('orva_finance.statements.pl.title', 'Profit & Loss')}</h2>
                <p className="text-xs text-muted-foreground">{from || '…'} → {to || '…'}</p>
              </div>
              <Section
                title={t('orva_finance.statements.pl.income', 'Income')}
                rows={data.pl.income}
                total={data.pl.totalIncome}
                totalLabel={t('orva_finance.statements.pl.totalIncome', 'Total income')}
              />
              <Section
                title={t('orva_finance.statements.pl.expense', 'Expenses')}
                rows={data.pl.expense}
                total={data.pl.totalExpense}
                totalLabel={t('orva_finance.statements.pl.totalExpense', 'Total expenses')}
              />
              <div className={`flex items-center justify-between rounded-md px-3 py-2 text-sm font-semibold ${netPositive ? 'bg-accent/50' : 'bg-destructive/10 text-destructive'}`}>
                <span>{t('orva_finance.statements.pl.netProfit', 'Net profit')}</span>
                <span className="tabular-nums">{fmt(data.pl.netProfit)}</span>
              </div>
            </div>

            <div className="rounded-md border p-4 flex flex-col gap-4">
              <div>
                <h2 className="text-base font-semibold">{t('orva_finance.statements.bs.title', 'Balance Sheet')}</h2>
                <p className="text-xs text-muted-foreground">
                  {t('orva_finance.statements.bs.asOf', 'As of')} {to || t('orva_finance.statements.bs.allTime', 'all time')}
                  {data.balanceSheet.balanced ? (
                    <span className="ml-2 text-muted-foreground">{t('orva_finance.journals.form.balanced', 'Balanced')} ✓</span>
                  ) : (
                    <span className="ml-2 text-destructive">{t('orva_finance.journals.form.unbalanced', 'Out of balance')}</span>
                  )}
                </p>
              </div>
              <Section
                title={t('orva_finance.statements.bs.assets', 'Assets')}
                rows={data.balanceSheet.asset}
                total={data.balanceSheet.totalAssets}
                totalLabel={t('orva_finance.statements.bs.totalAssets', 'Total assets')}
              />
              <Section
                title={t('orva_finance.statements.bs.liabilities', 'Liabilities')}
                rows={data.balanceSheet.liability}
                total={data.balanceSheet.totalLiabilities}
                totalLabel={t('orva_finance.statements.bs.totalLiabilities', 'Total liabilities')}
              />
              <Section
                title={t('orva_finance.statements.bs.equity', 'Equity')}
                rows={data.balanceSheet.equity}
                total={data.balanceSheet.totalEquity}
                totalLabel={t('orva_finance.statements.bs.totalEquity', 'Total equity')}
                extraRows={[{
                  label: t('orva_finance.statements.bs.currentEarnings', 'Current earnings'),
                  value: data.balanceSheet.currentEarnings,
                }]}
              />
              <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm font-semibold">
                <span>{t('orva_finance.statements.bs.totalLiabEquity', 'Liabilities + equity')}</span>
                <span className="tabular-nums">{fmt(data.balanceSheet.totalLiabilitiesAndEquity)}</span>
              </div>
            </div>
          </div>
        )}
      </PageBody>
    </Page>
  )
}
