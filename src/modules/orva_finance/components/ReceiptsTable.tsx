"use client"
import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type ReceiptRow = {
  id: string
  receipt_no?: string | null
  status: string
  receipt_date: string
  total_amount?: string | number
}

export default function ReceiptsTable() {
  const t = useT()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const scopeVersion = useOrganizationScopeVersion()
  const [page, setPage] = React.useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['orva_finance.ar.receipts', page, scopeVersion],
    queryFn: async () =>
      fetchCrudList<ReceiptRow>('orva_finance/ar/receipts', {
        page, pageSize: 50, sortField: 'created_at', sortDir: 'desc',
      }),
  })

  const fmt = (v: string | number | undefined) =>
    Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const columns: ColumnDef<ReceiptRow>[] = React.useMemo(() => [
    { accessorKey: 'receipt_no', header: t('orva_finance.receipts.column.no', 'Receipt #'), meta: { priority: 1 } },
    { accessorKey: 'receipt_date', header: t('orva_finance.ap.column.date', 'Date'), meta: { priority: 2 } },
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
      accessorKey: 'total_amount',
      header: t('orva_finance.ap.column.total', 'Total'),
      meta: { priority: 2 },
      cell: ({ getValue }) => <span className="tabular-nums">{fmt(getValue() as string)}</span>,
    },
  ], [t])

  return (
    <>
      <DataTable
        title={t('orva_finance.receipts.page.title', 'Customer Receipts')}
        actions={(
          <Button asChild>
            <Link href="/backend/ar/receipts/create">{t('orva_finance.receipts.actions.create', 'Create receipt')}</Link>
          </Button>
        )}
        columns={columns}
        data={data?.items ?? []}
        entityId="orva_finance:ar_receipt"
        perspective={{ tableId: 'orva_finance.ar.receipts.list' }}
        rowActions={(row) => (
          <RowActions
            items={row.status === 'draft' ? [
              {
                label: t('orva_finance.receipts.actions.post', 'Post'),
                onSelect: async () => {
                  const confirmed = await confirm({
                    title: t('orva_finance.receipts.confirmPost', 'Post this receipt? Invoices will be settled and the receipt becomes immutable.'),
                  })
                  if (!confirmed) return
                  await readApiResultOrThrow('/api/orva_finance/ar/receipts/post', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ id: row.id }),
                  })
                  flash(t('orva_finance.receipts.flash.posted', 'Receipt posted'), 'success')
                  queryClient.invalidateQueries({ queryKey: ['orva_finance.ar.receipts'] })
                  queryClient.invalidateQueries({ queryKey: ['orva_finance.ar.open-items'] })
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
