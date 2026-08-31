"use client"
import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { fetchCrudList, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { OrvaEmptyState } from '@/components/orva/NodeMark'

type PartyRow = {
  id: string
  kind: string
  display_name: string
  email?: string | null
  phone?: string | null
  created_at?: string | null
  updated_at?: string | null
}

type PartiesResponse = {
  items: PartyRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export default function PartiesTable() {
  const t = useT()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const scopeVersion = useOrganizationScopeVersion()
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'created_at', desc: true }])

  const sortField = sorting[0]?.id ?? 'created_at'
  const sortDir = sorting[0]?.desc === false ? 'asc' : 'desc'

  const { data, isLoading, error } = useQuery({
    queryKey: ['orva_party.parties', page, search, sortField, sortDir, scopeVersion],
    queryFn: async () =>
      fetchCrudList<PartyRow>('orva_party/parties', {
        page,
        pageSize: 50,
        sortField,
        sortDir,
        ...(search ? { search } : {}),
      }) as Promise<PartiesResponse>,
  })

  const columns: ColumnDef<PartyRow>[] = React.useMemo(() => [
    { accessorKey: 'display_name', header: t('orva_party.table.column.displayName', 'Name'), meta: { priority: 1 } },
    {
      accessorKey: 'kind',
      header: t('orva_party.table.column.kind', 'Type'),
      meta: { priority: 2 },
      cell: ({ getValue }) => {
        const kind = String(getValue() ?? '')
        return kind === 'company'
          ? t('orva_party.kind.company', 'Company')
          : t('orva_party.kind.person', 'Person')
      },
    },
    { accessorKey: 'email', header: t('orva_party.table.column.email', 'Email'), meta: { priority: 3 } },
    { accessorKey: 'phone', header: t('orva_party.table.column.phone', 'Phone'), enableSorting: false, meta: { priority: 4 } },
  ], [t])

  if (error) {
    return <div className="text-sm text-destructive">{t('orva_party.table.error.generic', 'Failed to load parties')}</div>
  }

  return (
    <>
      <DataTable
        title={t('orva_party.page.title', 'Vendors')}
        emptyState={(
          <OrvaEmptyState
            title={t('orva_party.parties.empty.title', 'No vendors yet')}
            description={t('orva_party.parties.empty.description', 'Record vendors here, then bill and pay them from the Finance menu. Customers live in the Customers menu.')}
          />
        )}
        actions={(
          <Button asChild>
            <Link href="/backend/parties/create">{t('orva_party.table.actions.create', 'Add vendor')}</Link>
          </Button>
        )}
        columns={columns}
        data={data?.items ?? []}
        searchValue={search}
        onSearchChange={(value) => { setSearch(value); setPage(1) }}
        entityId="orva_party:party"
        sortable
        sorting={sorting}
        onSortingChange={(next) => { setSorting(next); setPage(1) }}
        perspective={{ tableId: 'orva_party.parties.list' }}
        rowActions={(row) => (
          <RowActions
            items={[
              { label: t('orva_party.table.actions.edit', 'Edit'), href: `/backend/parties/${row.id}/edit` },
              {
                label: t('orva_party.table.actions.delete', 'Delete'),
                destructive: true,
                onSelect: async () => {
                  const confirmed = await confirm({
                    title: t('orva_party.table.confirmDelete.title', 'Delete party?'),
                    variant: 'destructive',
                  })
                  if (!confirmed) return
                  try {
                    await withScopedApiRequestHeaders(
                      buildOptimisticLockHeader(row.updated_at),
                      () => deleteCrud('orva_party/parties', row.id),
                    )
                    flash(t('orva_party.form.flash.deleted', 'Party deleted'), 'success')
                    queryClient.invalidateQueries({ queryKey: ['orva_party.parties'] })
                  } catch (err) {
                    if (surfaceRecordConflict(err, t)) {
                      queryClient.invalidateQueries({ queryKey: ['orva_party.parties'] })
                      return
                    }
                    throw err
                  }
                },
              },
            ]}
          />
        )}
        pagination={{
          page,
          pageSize: 50,
          total: data?.total || 0,
          totalPages: data?.totalPages || 0,
          onPageChange: setPage,
        }}
        isLoading={isLoading}
        onRowClick={(row) => router.push(`/backend/parties/${row.id}/edit`)}
      />
      {ConfirmDialogElement}
    </>
  )
}
