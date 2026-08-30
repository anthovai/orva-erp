"use client"
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Input } from '@open-mercato/ui/primitives/input'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type AgingRow = {
  ref: string
  partyName: string | null
  dueDate: string | null
  daysOverdue: number
  bucket: 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus'
  remaining: string
}

type Side = {
  rows: AgingRow[]
  totals: { current: string; d1_30: string; d31_60: string; d61_90: string; d90_plus: string; total: string }
}

type AgingResponse = { asOf: string; ap: Side; ar: Side }

const fmt = (v: string | number) =>
  Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const

function bucketTone(bucket: AgingRow['bucket']): string {
  switch (bucket) {
    case 'current': return 'bg-accent/50'
    case 'd1_30': return 'bg-status-warning-bg text-status-warning-text'
    case 'd31_60': return 'bg-status-warning-bg text-status-warning-text'
    default: return 'bg-destructive/10 text-destructive'
  }
}

function AgingPanel({ title, side, showParty, partyHeader }: {
  title: string
  side: Side
  showParty: boolean
  partyHeader: string
}) {
  const t = useT()
  const bucketLabel: Record<string, string> = {
    current: t('orva_finance.aging.bucket.current', 'Current'),
    d1_30: t('orva_finance.aging.bucket.d1_30', '1–30'),
    d31_60: t('orva_finance.aging.bucket.d31_60', '31–60'),
    d61_90: t('orva_finance.aging.bucket.d61_90', '61–90'),
    d90_plus: t('orva_finance.aging.bucket.d90_plus', '90+'),
  }
  return (
    <div className="rounded-md border p-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold">{title}</h2>
        <span className="text-sm font-semibold tabular-nums">{fmt(side.totals.total)}</span>
      </div>
      <div className="grid grid-cols-5 gap-2 text-center text-xs">
        {BUCKETS.map((bucket) => (
          <div key={bucket} className={`rounded-md px-2 py-1.5 ${bucketTone(bucket)}`}>
            <div className="font-medium">{bucketLabel[bucket]}</div>
            <div className="tabular-nums">{fmt(side.totals[bucket])}</div>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left">
              <th className="px-2 py-1.5">{t('orva_finance.aging.column.ref', 'Document')}</th>
              {showParty ? <th className="px-2 py-1.5">{partyHeader}</th> : null}
              <th className="px-2 py-1.5">{t('orva_finance.aging.column.due', 'Due')}</th>
              <th className="px-2 py-1.5 text-right">{t('orva_finance.aging.column.days', 'Days')}</th>
              <th className="px-2 py-1.5">{t('orva_finance.aging.column.bucket', 'Bucket')}</th>
              <th className="px-2 py-1.5 text-right">{t('orva_finance.payments.form.remaining', 'Remaining')}</th>
            </tr>
          </thead>
          <tbody>
            {side.rows.length === 0 ? (
              <tr>
                <td className="px-2 py-4 text-center text-muted-foreground" colSpan={showParty ? 6 : 5}>
                  {t('orva_finance.aging.empty', 'Nothing outstanding')}
                </td>
              </tr>
            ) : side.rows.map((row) => (
              <tr key={row.ref} className="border-b last:border-b-0">
                <td className="px-2 py-1.5 font-medium">{row.ref}</td>
                {showParty ? <td className="px-2 py-1.5">{row.partyName ?? '—'}</td> : null}
                <td className="px-2 py-1.5">{row.dueDate ?? '—'}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{row.daysOverdue || '—'}</td>
                <td className="px-2 py-1.5">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${bucketTone(row.bucket)}`}>
                    {bucketLabel[row.bucket]}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{fmt(row.remaining)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function AgingReport() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [asOf, setAsOf] = React.useState(() => new Date().toISOString().slice(0, 10))

  const { data, isLoading, error } = useQuery({
    queryKey: ['orva_finance.aging', asOf, scopeVersion],
    queryFn: async () =>
      readApiResultOrThrow<AgingResponse>(`/api/orva_finance/reports/aging${asOf ? `?asOf=${asOf}` : ''}`),
  })

  return (
    <Page>
      <PageHeader
        title={t('orva_finance.aging.page.title', 'AP/AR Aging')}
        actions={<Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />}
      />
      <PageBody>
        {error ? (
          <div className="text-sm text-destructive">{t('orva_finance.aging.error', 'Failed to load aging report')}</div>
        ) : isLoading || !data ? (
          <div className="text-sm text-muted-foreground">…</div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-2">
            <AgingPanel
              title={t('orva_finance.aging.ap.title', 'Accounts Payable')}
              side={data.ap}
              showParty
              partyHeader={t('orva_finance.ap.column.vendor', 'Vendor')}
            />
            <AgingPanel
              title={t('orva_finance.aging.ar.title', 'Accounts Receivable')}
              side={data.ar}
              showParty={false}
              partyHeader=""
            />
          </div>
        )}
      </PageBody>
    </Page>
  )
}
