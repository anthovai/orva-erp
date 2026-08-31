"use client"
import * as React from 'react'
import Link from 'next/link'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  DEFAULT_SETTINGS,
  hydrateFinanceOverviewSettings,
  resolveRangeDates,
  type FinanceOverviewSettings,
} from './config'

type StatementsResponse = {
  pl?: { totalIncome?: string; netProfit?: string }
}
type AgingResponse = {
  ap?: { totals?: { total?: string; d90_plus?: string } }
  ar?: { totals?: { total?: string; d90_plus?: string } }
}

type Figures = {
  income: number
  netProfit: number
  receivable: number
  receivableOverdue: number
  payable: number
}

function formatMoney(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

async function loadFigures(settings: FinanceOverviewSettings): Promise<Figures> {
  const { from, to } = resolveRangeDates(settings.range)
  const [statements, aging] = await Promise.all([
    apiCall<StatementsResponse>(`/api/orva_finance/gl/reports/statements?from=${from}&to=${to}`),
    apiCall<AgingResponse>('/api/orva_finance/reports/aging'),
  ])
  if (!statements.ok) throw new Error('statements')
  const pl = statements.result?.pl
  const totals = aging.ok ? aging.result : undefined
  return {
    income: Number(pl?.totalIncome ?? 0),
    netProfit: Number(pl?.netProfit ?? 0),
    receivable: Number(totals?.ar?.totals?.total ?? 0),
    receivableOverdue: Number(totals?.ar?.totals?.d90_plus ?? 0),
    payable: Number(totals?.ap?.totals?.total ?? 0),
  }
}

/** One KPI cell: label, money value in tabular figures, optional hint. */
function Figure({
  label,
  value,
  hint,
  tone,
  href,
}: {
  label: string
  value: number
  hint?: string
  tone?: 'positive' | 'negative' | 'attention'
  href: string
}) {
  const toneClass =
    tone === 'negative'
      ? 'text-status-error-text'
      : tone === 'attention'
        ? 'text-status-warning-text'
        : tone === 'positive'
          ? 'text-status-success-text'
          : 'text-foreground'
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-lg border bg-card p-4 transition-colors hover:bg-accent/60"
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-xl font-semibold tabular-nums ${toneClass}`}>{formatMoney(value)}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </Link>
  )
}

export default function FinanceOverviewWidget({ settings, onSettingsChange, mode }: DashboardWidgetComponentProps<FinanceOverviewSettings>) {
  const t = useT()
  const resolved = React.useMemo(() => hydrateFinanceOverviewSettings(settings ?? DEFAULT_SETTINGS), [settings])
  const [figures, setFigures] = React.useState<Figures | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailed(false)
    loadFigures(resolved)
      .then((next) => { if (!cancelled) setFigures(next) })
      .catch(() => { if (!cancelled) setFailed(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [resolved])

  if (mode === 'settings') {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-xs text-muted-foreground">{t('orva_finance.widget.overview.rangeLabel', 'Reporting period')}</span>
        <Select
          value={resolved.range}
          onValueChange={(value) => onSettingsChange?.({ range: value as FinanceOverviewSettings['range'] })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="month">{t('orva_finance.widget.overview.range.month', 'This month')}</SelectItem>
            <SelectItem value="quarter">{t('orva_finance.widget.overview.range.quarter', 'This quarter')}</SelectItem>
            <SelectItem value="year">{t('orva_finance.widget.overview.range.year', 'This year')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    )
  }

  if (loading) {
    return <div className="flex items-center justify-center py-8"><Spinner /></div>
  }
  if (failed || !figures) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t('orva_finance.widget.overview.unavailable', 'Financial figures are unavailable right now.')}
      </p>
    )
  }

  const rangeLabel = t(`orva_finance.widget.overview.range.${resolved.range}`, 'This month')

  return (
    <div className="flex flex-col gap-3">
      <span className="text-xs text-muted-foreground">{rangeLabel}</span>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Figure
          label={t('orva_finance.widget.overview.income', 'Revenue')}
          value={figures.income}
          href="/backend/gl/statements"
        />
        <Figure
          label={t('orva_finance.widget.overview.netProfit', 'Net profit')}
          value={figures.netProfit}
          tone={figures.netProfit < 0 ? 'negative' : 'positive'}
          href="/backend/gl/statements"
        />
        <Figure
          label={t('orva_finance.widget.overview.receivable', 'Receivables outstanding')}
          value={figures.receivable}
          tone={figures.receivableOverdue > 0 ? 'attention' : undefined}
          hint={
            figures.receivableOverdue > 0
              ? t('orva_finance.widget.overview.overdueHint', 'Includes {amount} more than 90 days overdue')
                  .replace('{amount}', formatMoney(figures.receivableOverdue))
              : undefined
          }
          href="/backend/reports/aging"
        />
        <Figure
          label={t('orva_finance.widget.overview.payable', 'Payables outstanding')}
          value={figures.payable}
          href="/backend/reports/aging"
        />
      </div>
    </div>
  )
}
