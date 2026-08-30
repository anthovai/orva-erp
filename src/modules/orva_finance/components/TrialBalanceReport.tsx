"use client"
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type PeriodOption = { id: string; code: string; status: string }

type TrialBalanceRow = {
  account_id: string
  code: string
  name: string
  account_type: string
  total_debit: string
  total_credit: string
}

type TrialBalanceResponse = {
  rows: TrialBalanceRow[]
  totals: { debit: string; credit: string; balanced: boolean }
}

const selectClass =
  'h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'

export default function TrialBalanceReport() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [periodId, setPeriodId] = React.useState('')

  const { data: periodsData } = useQuery({
    queryKey: ['orva_finance.periods.options', scopeVersion],
    queryFn: async () =>
      fetchCrudList<PeriodOption>('orva_finance/gl/periods', {
        page: 1, pageSize: 100, sortField: 'starts_on', sortDir: 'desc',
      }),
  })

  const { data, isLoading, error } = useQuery({
    queryKey: ['orva_finance.trial-balance', periodId, scopeVersion],
    queryFn: async () =>
      readApiResultOrThrow<TrialBalanceResponse>(
        `/api/orva_finance/gl/reports/trial-balance${periodId ? `?periodId=${periodId}` : ''}`,
      ),
  })

  const fmt = (v: string | number) =>
    Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const rows = (data?.rows ?? []).filter((row) => Number(row.total_debit) !== 0 || Number(row.total_credit) !== 0)
  const zeroRows = (data?.rows?.length ?? 0) - rows.length

  return (
    <Page>
      <PageHeader
        title={t('orva_finance.trialBalance.page.title', 'Trial Balance')}
        actions={(
          <select className={selectClass} value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            <option value="">{t('orva_finance.trialBalance.allPeriods', 'All periods')}</option>
            {(periodsData?.items ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.code}</option>
            ))}
          </select>
        )}
      />
      <PageBody>
        {error ? (
          <div className="text-sm text-destructive">{t('orva_finance.trialBalance.error', 'Failed to load trial balance')}</div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left">
                    <th className="px-3 py-2">{t('orva_finance.accounts.column.code', 'Code')}</th>
                    <th className="px-3 py-2">{t('orva_finance.accounts.column.name', 'Name')}</th>
                    <th className="px-3 py-2">{t('orva_finance.accounts.column.type', 'Type')}</th>
                    <th className="px-3 py-2 text-right">{t('orva_finance.journals.column.debit', 'Debit')}</th>
                    <th className="px-3 py-2 text-right">{t('orva_finance.journals.column.credit', 'Credit')}</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td className="px-3 py-6 text-center text-muted-foreground" colSpan={5}>…</td></tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-muted-foreground" colSpan={5}>
                        {t('orva_finance.trialBalance.empty', 'No posted journals in this scope yet')}
                      </td>
                    </tr>
                  ) : rows.map((row) => (
                    <tr key={row.account_id} className="border-b last:border-b-0">
                      <td className="px-3 py-2 font-medium">{row.code}</td>
                      <td className="px-3 py-2">{row.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {t(`orva_finance.accountType.${row.account_type}`, row.account_type)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(row.total_debit)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(row.total_credit)}</td>
                    </tr>
                  ))}
                </tbody>
                {data ? (
                  <tfoot>
                    <tr className="bg-muted/30 font-semibold">
                      <td className="px-3 py-2" colSpan={3}>
                        {t('orva_finance.trialBalance.totals', 'Totals')}
                        {data.totals.balanced ? (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {t('orva_finance.journals.form.balanced', 'Balanced')} ✓
                          </span>
                        ) : (
                          <span className="ml-2 text-xs font-normal text-destructive">
                            {t('orva_finance.journals.form.unbalanced', 'Out of balance')}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(data.totals.debit)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(data.totals.credit)}</td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
            {zeroRows > 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('orva_finance.trialBalance.zeroHidden', 'Accounts with no activity are hidden')} ({zeroRows})
              </p>
            ) : null}
          </div>
        )}
      </PageBody>
    </Page>
  )
}
