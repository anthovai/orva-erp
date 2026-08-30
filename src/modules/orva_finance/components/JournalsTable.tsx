"use client"
import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type JournalRow = {
  id: string
  journal_no?: string | null
  status: string
  journal_date: string
  currency_code: string
  memo?: string | null
  total_debit?: string | number
  total_credit?: string | number
}

export default function JournalsTable() {
  const t = useT()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const scopeVersion = useOrganizationScopeVersion()
  const [page, setPage] = React.useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['orva_finance.journals', page, scopeVersion],
    queryFn: async () =>
      fetchCrudList<JournalRow>('orva_finance/gl/journals', {
        page, pageSize: 50, sortField: 'created_at', sortDir: 'desc',
      }),
  })

  const columns: ColumnDef<JournalRow>[] = React.useMemo(() => [
    { accessorKey: 'journal_no', header: t('orva_finance.journals.column.no', 'Journal #'), meta: { priority: 1 } },
    { accessorKey: 'journal_date', header: t('orva_finance.journals.column.date', 'Date'), meta: { priority: 2 } },
    {
      accessorKey: 'status',
      header: t('orva_finance.journals.column.status', 'Status'),
      meta: { priority: 1 },
      cell: ({ getValue }) => {
        const status = String(getValue())
        return (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${status === 'posted' ? 'bg-accent/50' : 'bg-muted text-muted-foreground'}`}>
            {t(`orva_finance.journalStatus.${status}`, status)}
          </span>
        )
      },
    },
    {
      accessorKey: 'total_debit',
      header: t('orva_finance.journals.column.debit', 'Debit'),
      meta: { priority: 2 },
      cell: ({ getValue }) => <span className="tabular-nums">{Number(getValue() ?? 0).toFixed(2)}</span>,
    },
    {
      accessorKey: 'total_credit',
      header: t('orva_finance.journals.column.credit', 'Credit'),
      meta: { priority: 2 },
      cell: ({ getValue }) => <span className="tabular-nums">{Number(getValue() ?? 0).toFixed(2)}</span>,
    },
    { accessorKey: 'memo', header: t('orva_finance.journals.column.memo', 'Memo'), enableSorting: false, meta: { priority: 3 } },
  ], [t])

  return (
    <>
      <DataTable
        title={t('orva_finance.journals.page.title', 'GL Journals')}
        columns={columns}
        data={data?.items ?? []}
        entityId="orva_finance:gl_journal"
        perspective={{ tableId: 'orva_finance.gl.journals.list' }}
        rowActions={(row) => (
          <RowActions
            items={row.status === 'draft' ? [
              {
                label: t('orva_finance.journals.actions.post', 'Post'),
                onSelect: async () => {
                  const confirmed = await confirm({
                    title: t('orva_finance.journals.confirmPost', 'Post this journal? Posted journals are immutable.'),
                  })
                  if (!confirmed) return
                  await readApiResultOrThrow('/api/orva_finance/gl/journals/post', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ id: row.id }),
                  })
                  flash(t('orva_finance.journals.flash.posted', 'Journal posted'), 'success')
                  queryClient.invalidateQueries({ queryKey: ['orva_finance.journals'] })
                },
              },
            ] : []}
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
