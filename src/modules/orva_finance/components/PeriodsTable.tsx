"use client"
import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type PeriodRow = {
  id: string
  code: string
  starts_on: string
  ends_on: string
  status: string
}

type AccountRow = { id: string; code: string; name: string; account_type: string }

const selectClass =
  'h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'

function RetainedEarningsBanner() {
  const t = useT()
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const [selected, setSelected] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  const { data: settings } = useQuery({
    queryKey: ['orva_finance.gl.settings', scopeVersion],
    queryFn: async () => readApiResultOrThrow<{ retainedEarningsAccountId: string | null }>('/api/orva_finance/gl/settings'),
  })
  const { data: accountsData } = useQuery({
    queryKey: ['orva_finance.accounts.equity', scopeVersion],
    queryFn: async () =>
      fetchCrudList<AccountRow>('orva_finance/gl/accounts', {
        page: 1, pageSize: 100, sortField: 'code', sortDir: 'asc', accountType: 'equity', isActive: true,
      }),
    enabled: settings?.retainedEarningsAccountId === null,
  })

  if (!settings || settings.retainedEarningsAccountId) return null

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
      <span>{t('orva_finance.gl.settings.reMissing', 'Set the retained-earnings account (equity) to enable period closing:')}</span>
      <select className={selectClass} value={selected} onChange={(e) => setSelected(e.target.value)}>
        <option value="">{t('orva_finance.journals.form.selectAccount', '— select account —')}</option>
        {(accountsData?.items ?? []).map((a) => (<option key={a.id} value={a.id}>{a.code} · {a.name}</option>))}
      </select>
      <Button
        size="sm" disabled={!selected || saving}
        onClick={async () => {
          setSaving(true)
          try {
            await readApiResultOrThrow('/api/orva_finance/gl/settings', {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ retainedEarningsAccountId: selected }),
            })
            flash(t('orva_finance.gl.settings.reSaved', 'Retained-earnings account saved'), 'success')
            queryClient.invalidateQueries({ queryKey: ['orva_finance.gl.settings'] })
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

export default function PeriodsTable() {
  const t = useT()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const scopeVersion = useOrganizationScopeVersion()
  const [page, setPage] = React.useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['orva_finance.periods', page, scopeVersion],
    queryFn: async () =>
      fetchCrudList<PeriodRow>('orva_finance/gl/periods', {
        page, pageSize: 50, sortField: 'starts_on', sortDir: 'desc',
      }),
  })

  const columns: ColumnDef<PeriodRow>[] = React.useMemo(() => [
    { accessorKey: 'code', header: t('orva_finance.periods.column.code', 'Period'), meta: { priority: 1 } },
    { accessorKey: 'starts_on', header: t('orva_finance.periods.column.startsOn', 'From'), meta: { priority: 2 } },
    { accessorKey: 'ends_on', header: t('orva_finance.periods.column.endsOn', 'To'), meta: { priority: 2 } },
    {
      accessorKey: 'status',
      header: t('orva_finance.periods.column.status', 'Status'),
      meta: { priority: 1 },
      cell: ({ getValue }) => {
        const status = String(getValue())
        return (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${status === 'open' ? 'bg-accent/50' : 'bg-muted text-muted-foreground'}`}>
            {t(`orva_finance.periodStatus.${status}`, status)}
          </span>
        )
      },
    },
  ], [t])

  return (
    <>
      <RetainedEarningsBanner />
      <DataTable
        title={t('orva_finance.periods.page.title', 'Fiscal Periods')}
        actions={(
          <Button asChild>
            <Link href="/backend/gl/periods/create">{t('orva_finance.periods.actions.create', 'Create period')}</Link>
          </Button>
        )}
        columns={columns}
        data={data?.items ?? []}
        entityId="orva_finance:fiscal_period"
        perspective={{ tableId: 'orva_finance.gl.periods.list' }}
        rowActions={(row) => (
          <RowActions
            items={row.status === 'open' ? [
              {
                label: t('orva_finance.periods.actions.closeWithEntries', 'Close period (book closing entries)'),
                destructive: true,
                onSelect: async () => {
                  const confirmed = await confirm({
                    title: t(
                      'orva_finance.periods.confirmCloseEntries',
                      'Close this period? Income and expenses will be booked into retained earnings and the period cannot be reopened.',
                    ),
                    variant: 'destructive',
                  })
                  if (!confirmed) return
                  try {
                    await readApiResultOrThrow('/api/orva_finance/gl/periods/close', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ periodId: row.id }),
                    })
                    flash(t('orva_finance.periods.flash.closed', 'Period closed — closing journal booked'), 'success')
                  } catch (err) {
                    flash(err instanceof Error ? err.message : 'Closing failed', 'error')
                  }
                  queryClient.invalidateQueries({ queryKey: ['orva_finance.periods'] })
                  queryClient.invalidateQueries({ queryKey: ['orva_finance.journals'] })
                },
              },
              {
                label: t('orva_finance.periods.actions.close', 'Close without entries'),
                onSelect: async () => {
                  const confirmed = await confirm({
                    title: t('orva_finance.periods.confirmClose', 'Close this period? Posting into it will be blocked.'),
                  })
                  if (!confirmed) return
                  await updateCrud('orva_finance/gl/periods', { id: row.id, status: 'closed' })
                  flash(t('orva_finance.periods.flash.saved', 'Period updated'), 'success')
                  queryClient.invalidateQueries({ queryKey: ['orva_finance.periods'] })
                },
              },
            ] : [
              {
                label: t('orva_finance.periods.actions.reopen', 'Reopen period'),
                onSelect: async () => {
                  const confirmed = await confirm({
                    title: t('orva_finance.periods.confirmReopen', 'Reopen this period?'),
                  })
                  if (!confirmed) return
                  try {
                    await updateCrud('orva_finance/gl/periods', { id: row.id, status: 'open' })
                    flash(t('orva_finance.periods.flash.saved', 'Period updated'), 'success')
                  } catch (err) {
                    flash(err instanceof Error ? err.message : 'Reopen failed', 'error')
                  }
                  queryClient.invalidateQueries({ queryKey: ['orva_finance.periods'] })
                },
              },
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
      />
      {ConfirmDialogElement}
    </>
  )
}
