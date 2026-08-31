"use client"
import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { BooleanIcon } from '@open-mercato/ui/backend/ValueIcons'
import { Button } from '@open-mercato/ui/primitives/button'
import { fetchCrudList, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { OrvaEmptyState } from '@/components/orva/NodeMark'

type AccountRow = {
  id: string
  code: string
  name: string
  account_type: string
  is_active?: boolean
  updated_at?: string | null
}

export default function AccountsTable() {
  const t = useT()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const scopeVersion = useOrganizationScopeVersion()
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'code', desc: false }])

  const sortField = sorting[0]?.id ?? 'code'
  const sortDir = sorting[0]?.desc ? 'desc' : 'asc'

  const { data, isLoading } = useQuery({
    queryKey: ['orva_finance.accounts', page, search, sortField, sortDir, scopeVersion],
    queryFn: async () =>
      fetchCrudList<AccountRow>('orva_finance/gl/accounts', {
        page, pageSize: 50, sortField, sortDir, ...(search ? { search } : {}),
      }),
  })

  const columns: ColumnDef<AccountRow>[] = React.useMemo(() => [
    { accessorKey: 'code', header: t('orva_finance.accounts.column.code', 'Code'), meta: { priority: 1 } },
    { accessorKey: 'name', header: t('orva_finance.accounts.column.name', 'Name'), meta: { priority: 1 } },
    {
      accessorKey: 'account_type',
      header: t('orva_finance.accounts.column.type', 'Type'),
      meta: { priority: 2 },
      cell: ({ getValue }) => t(`orva_finance.accountType.${String(getValue())}`, String(getValue())),
    },
    {
      accessorKey: 'is_active',
      header: t('orva_finance.accounts.column.active', 'Active'),
      meta: { priority: 3 },
      cell: ({ getValue }) => <BooleanIcon value={!!getValue()} />,
    },
  ], [t])

  return (
    <>
      <DataTable
        title={t('orva_finance.accounts.page.title', 'Chart of Accounts')}
        emptyState={(
          <OrvaEmptyState
            title={t('orva_finance.accounts.empty.title', "No accounts yet")}
            description={t('orva_finance.accounts.empty.description', "Add the ledger accounts your business posts to — assets, liabilities, equity, income and expenses.")}
          />
        )}
        actions={(
          <Button asChild>
            <Link href="/backend/gl/accounts/create">{t('orva_finance.accounts.actions.create', 'Create account')}</Link>
          </Button>
        )}
        columns={columns}
        data={data?.items ?? []}
        searchValue={search}
        onSearchChange={(value) => { setSearch(value); setPage(1) }}
        entityId="orva_finance:gl_account"
        sortable
        sorting={sorting}
        onSortingChange={(next) => { setSorting(next); setPage(1) }}
        perspective={{ tableId: 'orva_finance.gl.accounts.list' }}
        rowActions={(row) => (
          <RowActions
            items={[
              { label: t('orva_finance.actions.edit', 'Edit'), href: `/backend/gl/accounts/${row.id}/edit` },
              {
                label: t('orva_finance.actions.delete', 'Delete'),
                destructive: true,
                onSelect: async () => {
                  const confirmed = await confirm({
                    title: t('orva_finance.accounts.confirmDelete', 'Delete account?'),
                    variant: 'destructive',
                  })
                  if (!confirmed) return
                  await withScopedApiRequestHeaders(
                    buildOptimisticLockHeader(row.updated_at),
                    () => deleteCrud('orva_finance/gl/accounts', row.id),
                  )
                  flash(t('orva_finance.accounts.flash.deleted', 'Account deleted'), 'success')
                  queryClient.invalidateQueries({ queryKey: ['orva_finance.accounts'] })
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
        onRowClick={(row) => router.push(`/backend/gl/accounts/${row.id}/edit`)}
      />
      {ConfirmDialogElement}
    </>
  )
}
