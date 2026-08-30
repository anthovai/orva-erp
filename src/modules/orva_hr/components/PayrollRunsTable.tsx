"use client"
import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { fetchCrudList, createCrud } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type RunRow = {
  id: string
  run_no?: string | null
  status: string
  month_code: string
  pay_date: string
  total_gross?: string | number
  total_net?: string | number
  engine_version?: string | null
}

type PeriodOption = { id: string; code: string }
type AccountRow = { id: string; code: string; name: string; account_type: string }
type HrSettingsDto = {
  salaryExpenseAccountId: string | null
  ssoExpenseAccountId: string | null
  ssoPayableAccountId: string | null
  taxPayableAccountId: string | null
  netPayableAccountId: string | null
}

const selectClass =
  'h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'

function HrSettingsCard() {
  const t = useT()
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const { data: settings } = useQuery({
    queryKey: ['orva_hr.settings', scopeVersion],
    queryFn: async () => readApiResultOrThrow<HrSettingsDto>('/api/orva_hr/settings'),
  })
  const { data: accountsData } = useQuery({
    queryKey: ['orva_finance.accounts.all', scopeVersion],
    queryFn: async () =>
      fetchCrudList<AccountRow>('orva_finance/gl/accounts', {
        page: 1, pageSize: 100, sortField: 'code', sortDir: 'asc', isActive: true,
      }),
  })
  const [values, setValues] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  const accounts = accountsData?.items ?? []
  const configured = Boolean(settings && Object.values(settings).every(Boolean))
  if (!settings || configured) return null

  const slots: Array<{ key: keyof HrSettingsDto; label: string; type: string }> = [
    { key: 'salaryExpenseAccountId', label: t('orva_hr.settings.salaryExpense', 'Salary expense'), type: 'expense' },
    { key: 'ssoExpenseAccountId', label: t('orva_hr.settings.ssoExpense', 'SSO expense'), type: 'expense' },
    { key: 'ssoPayableAccountId', label: t('orva_hr.settings.ssoPayable', 'SSO payable'), type: 'liability' },
    { key: 'taxPayableAccountId', label: t('orva_hr.settings.taxPayable', 'Tax payable'), type: 'liability' },
    { key: 'netPayableAccountId', label: t('orva_hr.settings.netPayable', 'Net salaries payable'), type: 'liability' },
  ]
  const allChosen = slots.every((slot) => values[slot.key] || settings[slot.key])

  return (
    <div className="mb-4 rounded-md border border-status-warning-border bg-status-warning-bg px-4 py-3 text-sm">
      <div className="mb-2 font-medium">
        {t('orva_hr.settings.missing', 'Set the payroll posting accounts before posting runs:')}
      </div>
      <div className="grid gap-2 md:grid-cols-5">
        {slots.map((slot) => (
          <label key={slot.key} className="flex flex-col gap-1 text-xs">
            <span className="font-medium">{slot.label}</span>
            <select
              className={selectClass}
              value={values[slot.key] ?? settings[slot.key] ?? ''}
              onChange={(e) => setValues((prev) => ({ ...prev, [slot.key]: e.target.value }))}
            >
              <option value="">—</option>
              {accounts.filter((a) => a.account_type === slot.type).map((a) => (
                <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <Button
        className="mt-3" size="sm" disabled={!allChosen || saving}
        onClick={async () => {
          setSaving(true)
          try {
            await readApiResultOrThrow('/api/orva_hr/settings', {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(Object.fromEntries(slots.map((slot) => [slot.key, values[slot.key] ?? settings[slot.key]]))),
            })
            flash(t('orva_hr.settings.saved', 'Payroll accounts saved'), 'success')
            queryClient.invalidateQueries({ queryKey: ['orva_hr.settings'] })
          } finally {
            setSaving(false)
          }
        }}
      >
        {t('orva_finance.form.edit.submit', 'Save')}
      </Button>
    </div>
  )
}

function CreateRunBar() {
  const t = useT()
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const [monthCode, setMonthCode] = React.useState(() => new Date().toISOString().slice(0, 7))
  const [periodId, setPeriodId] = React.useState('')
  const [payDate, setPayDate] = React.useState(() => new Date().toISOString().slice(0, 10))
  const [creating, setCreating] = React.useState(false)

  const { data: periodsData } = useQuery({
    queryKey: ['orva_finance.periods.open', scopeVersion],
    queryFn: async () =>
      fetchCrudList<PeriodOption>('orva_finance/gl/periods', {
        page: 1, pageSize: 100, sortField: 'starts_on', sortDir: 'desc', status: 'open',
      }),
  })

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Input value={monthCode} onChange={(e) => setMonthCode(e.target.value)} className="w-28" placeholder="2026-08" />
      <select className={selectClass} value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
        <option value="">{t('orva_finance.journals.form.selectPeriod', '— select open period —')}</option>
        {(periodsData?.items ?? []).map((p) => (<option key={p.id} value={p.id}>{p.code}</option>))}
      </select>
      <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
      <Button
        disabled={!monthCode || !periodId || !payDate || creating}
        onClick={async () => {
          setCreating(true)
          try {
            await createCrud('orva_hr/payroll-runs', { monthCode, periodId, payDate })
            flash(t('orva_hr.payroll.flash.created', 'Draft payroll run created'), 'success')
            queryClient.invalidateQueries({ queryKey: ['orva_hr.payroll-runs'] })
          } catch (err) {
            flash(err instanceof Error ? err.message : 'Create failed', 'error')
          } finally {
            setCreating(false)
          }
        }}
      >
        {t('orva_hr.payroll.actions.create', 'New run')}
      </Button>
    </div>
  )
}

export default function PayrollRunsTable() {
  const t = useT()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const scopeVersion = useOrganizationScopeVersion()
  const [page, setPage] = React.useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['orva_hr.payroll-runs', page, scopeVersion],
    queryFn: async () =>
      fetchCrudList<RunRow>('orva_hr/payroll-runs', {
        page, pageSize: 50, sortField: 'created_at', sortDir: 'desc',
      }),
  })

  const fmt = (v: string | number | undefined) =>
    Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const statusTone: Record<string, string> = {
    draft: 'bg-muted text-muted-foreground',
    calculated: 'bg-status-warning-bg text-status-warning-text',
    posted: 'bg-accent/50',
  }

  const columns: ColumnDef<RunRow>[] = React.useMemo(() => [
    { accessorKey: 'run_no', header: t('orva_hr.payroll.column.no', 'Run #'), meta: { priority: 1 } },
    { accessorKey: 'month_code', header: t('orva_hr.payroll.column.month', 'Month'), meta: { priority: 1 } },
    { accessorKey: 'pay_date', header: t('orva_hr.payroll.column.payDate', 'Pay date'), meta: { priority: 2 } },
    {
      accessorKey: 'status',
      header: t('orva_finance.journals.column.status', 'Status'),
      meta: { priority: 1 },
      cell: ({ getValue }) => {
        const status = String(getValue())
        return (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${statusTone[status] ?? ''}`}>
            {t(`orva_hr.runStatus.${status}`, status)}
          </span>
        )
      },
    },
    {
      accessorKey: 'total_gross',
      header: t('orva_hr.payroll.column.gross', 'Gross'),
      meta: { priority: 2 },
      cell: ({ getValue }) => <span className="tabular-nums">{fmt(getValue() as string)}</span>,
    },
    {
      accessorKey: 'total_net',
      header: t('orva_hr.payroll.column.net', 'Net'),
      meta: { priority: 2 },
      cell: ({ getValue }) => <span className="tabular-nums">{fmt(getValue() as string)}</span>,
    },
    { accessorKey: 'engine_version', header: t('orva_hr.payroll.column.engine', 'Engine'), enableSorting: false, meta: { priority: 5 } },
  ], [t])

  return (
    <>
      <HrSettingsCard />
      <DataTable
        title={t('orva_hr.payroll.page.title', 'Payroll Runs')}
        actions={<CreateRunBar />}
        columns={columns}
        data={data?.items ?? []}
        entityId="orva_hr:payroll_run"
        perspective={{ tableId: 'orva_hr.payroll.runs.list' }}
        rowActions={(row) => (
          <RowActions
            items={[
              ...(row.status !== 'posted' ? [{
                label: t('orva_hr.payroll.actions.calculate', 'Calculate (Rust engine)'),
                onSelect: async () => {
                  try {
                    await readApiResultOrThrow('/api/orva_hr/payroll-runs/calculate', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ id: row.id }),
                    })
                    flash(t('orva_hr.payroll.flash.calculated', 'Payroll calculated'), 'success')
                  } catch (err) {
                    flash(err instanceof Error ? err.message : 'Calculation failed', 'error')
                  }
                  queryClient.invalidateQueries({ queryKey: ['orva_hr.payroll-runs'] })
                },
              }] : []),
              ...(row.status === 'calculated' ? [{
                label: t('orva_hr.payroll.actions.post', 'Post to ledger'),
                onSelect: async () => {
                  const confirmed = await confirm({
                    title: t('orva_hr.payroll.confirmPost', 'Post this payroll run? The run becomes immutable.'),
                  })
                  if (!confirmed) return
                  try {
                    await readApiResultOrThrow('/api/orva_hr/payroll-runs/post', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ id: row.id }),
                    })
                    flash(t('orva_hr.payroll.flash.posted', 'Payroll posted to the ledger'), 'success')
                  } catch (err) {
                    flash(err instanceof Error ? err.message : 'Posting failed', 'error')
                  }
                  queryClient.invalidateQueries({ queryKey: ['orva_hr.payroll-runs'] })
                  queryClient.invalidateQueries({ queryKey: ['orva_finance.journals'] })
                },
              }] : []),
            ]}
          />
        )}
        pagination={{
          page, pageSize: 50,
          total: data?.total || 0,
          totalPages: data?.totalPages || 0,
          onPageChange: setPage,
        }}
        isLoading={isLoading}
        onRowClick={(row) => { window.location.href = `/backend/hr/payroll/${row.id}` }}
      />
      {ConfirmDialogElement}
    </>
  )
}
