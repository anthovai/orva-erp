"use client"
import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
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
            items={[
              {
                label: row.status === 'open'
                  ? t('orva_finance.periods.actions.close', 'Close period')
                  : t('orva_finance.periods.actions.reopen', 'Reopen period'),
                destructive: row.status === 'open',
                onSelect: async () => {
                  const next = row.status === 'open' ? 'closed' : 'open'
                  const confirmed = await confirm({
                    title: next === 'closed'
                      ? t('orva_finance.periods.confirmClose', 'Close this period? Posting into it will be blocked.')
                      : t('orva_finance.periods.confirmReopen', 'Reopen this period?'),
                    variant: next === 'closed' ? 'destructive' : undefined,
                  })
                  if (!confirmed) return
                  await updateCrud('orva_finance/gl/periods', { id: row.id, status: next })
                  flash(t('orva_finance.periods.flash.saved', 'Period updated'), 'success')
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
