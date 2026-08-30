"use client"
import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const LIST_HREF = '/backend/hr/payroll'

type RunDto = {
  id: string
  run_no?: string | null
  status: string
  month_code: string
  pay_date: string
  total_gross?: string | number
  total_sso_employee?: string | number
  total_sso_employer?: string | number
  total_wht?: string | number
  total_net?: string | number
  engine_version?: string | null
  journal_id?: string | null
}

type LineDto = {
  id: string
  employee_no?: string | null
  employee_name: string
  gross?: string | number
  sso_employee?: string | number
  sso_employer?: string | number
  wht?: string | number
  net?: string | number
}

const fmt = (v: string | number | undefined) =>
  Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'accent' }) {
  return (
    <div className={`rounded-md border px-4 py-3 ${tone === 'accent' ? 'bg-accent/40' : 'bg-card'}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  )
}

export default function PayrollRunDetail({ id }: { id: string }) {
  const t = useT()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const { data: runData, isLoading: runLoading } = useQuery({
    queryKey: ['orva_hr.payroll-run', id],
    queryFn: async () => fetchCrudList<RunDto>('orva_hr/payroll-runs', { ids: id, pageSize: 1 }),
  })
  const run = runData?.items?.[0]

  const { data: linesData, isLoading: linesLoading } = useQuery({
    queryKey: ['orva_hr.payroll-lines', id],
    queryFn: async () =>
      fetchCrudList<LineDto>('orva_hr/payroll-lines', { runId: id, pageSize: 200, sortField: 'employee_no', sortDir: 'asc' }),
  })
  const lines = linesData?.items ?? []

  const statusTone: Record<string, string> = {
    draft: 'bg-muted text-muted-foreground',
    calculated: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
    posted: 'bg-accent/50',
  }

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['orva_hr.payroll-run', id] })
    queryClient.invalidateQueries({ queryKey: ['orva_hr.payroll-lines', id] })
    queryClient.invalidateQueries({ queryKey: ['orva_hr.payroll-runs'] })
  }

  const calculate = async () => {
    try {
      await readApiResultOrThrow('/api/orva_hr/payroll-runs/calculate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      flash(t('orva_hr.payroll.flash.calculated', 'Payroll calculated'), 'success')
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Calculation failed', 'error')
    }
    invalidate()
  }

  const post = async () => {
    const confirmed = await confirm({
      title: t('orva_hr.payroll.confirmPost', 'Post this payroll run? The run becomes immutable.'),
    })
    if (!confirmed) return
    try {
      await readApiResultOrThrow('/api/orva_hr/payroll-runs/post', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      flash(t('orva_hr.payroll.flash.posted', 'Payroll posted to the ledger'), 'success')
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Posting failed', 'error')
    }
    invalidate()
    queryClient.invalidateQueries({ queryKey: ['orva_finance.journals'] })
  }

  return (
    <Page>
      <PageHeader
        title={run ? `${run.run_no ?? '—'} · ${run.month_code}` : t('orva_hr.payroll.detail.title', 'Payroll run')}
        actions={(
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link href={LIST_HREF}>{t('orva_hr.payroll.detail.back', 'Back to runs')}</Link>
            </Button>
            {run && run.status !== 'posted' ? (
              <Button variant="outline" onClick={calculate}>
                {t('orva_hr.payroll.actions.calculate', 'Calculate (Rust engine)')}
              </Button>
            ) : null}
            {run?.status === 'calculated' ? (
              <Button onClick={post}>{t('orva_hr.payroll.actions.post', 'Post to ledger')}</Button>
            ) : null}
          </div>
        )}
      />
      <PageBody>
        {runLoading ? (
          <div className="text-sm text-muted-foreground">…</div>
        ) : !run ? (
          <div className="text-sm text-destructive">{t('orva_hr.payroll.detail.notFound', 'Payroll run not found')}</div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${statusTone[run.status] ?? ''}`}>
                {t(`orva_hr.runStatus.${run.status}`, run.status)}
              </span>
              <span className="text-muted-foreground">
                {t('orva_hr.payroll.column.payDate', 'Pay date')}: {run.pay_date}
              </span>
              {run.engine_version ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs border bg-accent/30">
                  🦀 Rust engine v{run.engine_version}
                </span>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Stat label={t('orva_hr.payroll.column.gross', 'Gross')} value={fmt(run.total_gross)} />
              <Stat label={t('orva_hr.payroll.detail.ssoEmployee', 'SSO (employee)')} value={fmt(run.total_sso_employee)} />
              <Stat label={t('orva_hr.payroll.detail.ssoEmployer', 'SSO (employer)')} value={fmt(run.total_sso_employer)} />
              <Stat label={t('orva_hr.payroll.detail.wht', 'Withholding tax')} value={fmt(run.total_wht)} />
              <Stat label={t('orva_hr.payroll.column.net', 'Net pay')} value={fmt(run.total_net)} tone="accent" />
            </div>

            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left">
                    <th className="px-3 py-2">{t('orva_hr.employees.column.no', 'Employee #')}</th>
                    <th className="px-3 py-2">{t('orva_hr.employees.column.name', 'Name')}</th>
                    <th className="px-3 py-2 text-right">{t('orva_hr.payroll.column.gross', 'Gross')}</th>
                    <th className="px-3 py-2 text-right">{t('orva_hr.payroll.detail.ssoEmployee', 'SSO (employee)')}</th>
                    <th className="px-3 py-2 text-right">{t('orva_hr.payroll.detail.ssoEmployer', 'SSO (employer)')}</th>
                    <th className="px-3 py-2 text-right">{t('orva_hr.payroll.detail.wht', 'WHT')}</th>
                    <th className="px-3 py-2 text-right">{t('orva_hr.payroll.column.net', 'Net')}</th>
                  </tr>
                </thead>
                <tbody>
                  {linesLoading ? (
                    <tr><td className="px-3 py-6 text-center text-muted-foreground" colSpan={7}>…</td></tr>
                  ) : lines.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-center text-muted-foreground" colSpan={7}>
                        {t('orva_hr.payroll.detail.noLines', 'No lines yet — run Calculate to compute this month')}
                      </td>
                    </tr>
                  ) : lines.map((line) => (
                    <tr key={line.id} className="border-b last:border-b-0">
                      <td className="px-3 py-2 font-medium">{line.employee_no ?? '—'}</td>
                      <td className="px-3 py-2">{line.employee_name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(line.gross)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(line.sso_employee)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(line.sso_employer)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(line.wht)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt(line.net)}</td>
                    </tr>
                  ))}
                </tbody>
                {lines.length > 0 && run ? (
                  <tfoot>
                    <tr className="bg-muted/30 font-semibold">
                      <td className="px-3 py-2" colSpan={2}>
                        {t('orva_hr.payroll.detail.totals', 'Totals')} · {lines.length} {t('orva_hr.payroll.detail.people', 'people')}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(run.total_gross)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(run.total_sso_employee)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(run.total_sso_employer)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(run.total_wht)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(run.total_net)}</td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </div>
        )}
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
