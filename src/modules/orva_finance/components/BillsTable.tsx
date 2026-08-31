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
import { OrvaEmptyState } from '@/components/orva/NodeMark'

type BillRow = {
  id: string
  bill_no?: string | null
  status: string
  vendor_party_id: string
  vendor_bill_ref?: string | null
  bill_date: string
  due_date?: string | null
  total_amount?: string | number
  paid_amount?: string | number
  journal_id?: string | null
}

type PartyRow = { id: string; display_name: string }
type AccountRow = { id: string; code: string; name: string; account_type: string }

const selectClass =
  'h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'

function ApSettingsBanner() {
  const t = useT()
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const [selected, setSelected] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  const { data: settings } = useQuery({
    queryKey: ['orva_finance.ap.settings', scopeVersion],
    queryFn: async () => readApiResultOrThrow<{ apAccountId: string | null }>('/api/orva_finance/ap/settings'),
  })
  const { data: accountsData } = useQuery({
    queryKey: ['orva_finance.accounts.liability', scopeVersion],
    queryFn: async () =>
      fetchCrudList<AccountRow>('orva_finance/gl/accounts', {
        page: 1, pageSize: 100, sortField: 'code', sortDir: 'asc', accountType: 'liability', isActive: true,
      }),
    enabled: settings?.apAccountId === null,
  })

  if (!settings || settings.apAccountId) return null

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-status-warning-border bg-status-warning-bg px-4 py-3 text-sm">
      <span>{t('orva_finance.ap.settings.missing', 'Set the AP control account (liability) before posting bills:')}</span>
      <select className={selectClass} value={selected} onChange={(e) => setSelected(e.target.value)}>
        <option value="">{t('orva_finance.journals.form.selectAccount', '— select account —')}</option>
        {(accountsData?.items ?? []).map((a) => (
          <option key={a.id} value={a.id}>{a.code} · {a.name}</option>
        ))}
      </select>
      <Button
        size="sm" disabled={!selected || saving}
        onClick={async () => {
          setSaving(true)
          try {
            await readApiResultOrThrow('/api/orva_finance/ap/settings', {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ apAccountId: selected }),
            })
            flash(t('orva_finance.ap.settings.saved', 'AP control account saved'), 'success')
            queryClient.invalidateQueries({ queryKey: ['orva_finance.ap.settings'] })
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

export default function BillsTable() {
  const t = useT()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const scopeVersion = useOrganizationScopeVersion()
  const [page, setPage] = React.useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['orva_finance.ap.bills', page, scopeVersion],
    queryFn: async () =>
      fetchCrudList<BillRow>('orva_finance/ap/bills', {
        page, pageSize: 50, sortField: 'created_at', sortDir: 'desc',
      }),
  })

  const vendorIds = React.useMemo(
    () => Array.from(new Set((data?.items ?? []).map((b) => b.vendor_party_id))),
    [data?.items],
  )
  const { data: vendorsData } = useQuery({
    queryKey: ['orva_finance.ap.vendors', vendorIds.join(','), scopeVersion],
    queryFn: async () =>
      fetchCrudList<PartyRow>('orva_party/parties', { ids: vendorIds.join(','), pageSize: 100 }),
    enabled: vendorIds.length > 0,
  })
  const vendorMap = React.useMemo(() => {
    const map: Record<string, string> = {}
    for (const v of vendorsData?.items ?? []) map[v.id] = v.display_name
    return map
  }, [vendorsData?.items])

  const fmt = (v: string | number | undefined) =>
    Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const columns: ColumnDef<BillRow>[] = React.useMemo(() => [
    { accessorKey: 'bill_no', header: t('orva_finance.ap.column.no', 'Bill #'), meta: { priority: 1 } },
    {
      accessorKey: 'vendor_party_id',
      header: t('orva_finance.ap.column.vendor', 'Vendor'),
      enableSorting: false,
      meta: { priority: 1 },
      cell: ({ getValue }) => vendorMap[String(getValue())] ?? '…',
    },
    { accessorKey: 'vendor_bill_ref', header: t('orva_finance.ap.column.ref', 'Vendor ref'), enableSorting: false, meta: { priority: 3 } },
    { accessorKey: 'bill_date', header: t('orva_finance.ap.column.date', 'Date'), meta: { priority: 2 } },
    { accessorKey: 'due_date', header: t('orva_finance.ap.column.due', 'Due'), meta: { priority: 3 } },
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
    {
      accessorKey: 'paid_amount',
      header: t('orva_finance.ap.column.paid', 'Paid'),
      meta: { priority: 3 },
      cell: ({ row }) => {
        const paid = Number(row.original.paid_amount ?? 0)
        const total = Number(row.original.total_amount ?? 0)
        const settled = row.original.status === 'posted' && total > 0 && paid >= total - 0.00005
        return (
          <span className={`tabular-nums ${settled ? 'text-muted-foreground' : ''}`}>
            {fmt(paid)}{settled ? ' ✓' : ''}
          </span>
        )
      },
    },
  ], [t, vendorMap])

  return (
    <>
      <ApSettingsBanner />
      <DataTable
        title={t('orva_finance.ap.page.title', 'Vendor Bills')}
        emptyState={(
          <OrvaEmptyState
            title={t('orva_finance.bills.empty.title', "No vendor bills yet")}
            description={t('orva_finance.bills.empty.description', "Record a supplier bill to book the expense and open a payable.")}
          />
        )}
        actions={(
          <Button asChild>
            <Link href="/backend/ap/bills/create">{t('orva_finance.ap.actions.create', 'Create bill')}</Link>
          </Button>
        )}
        columns={columns}
        data={data?.items ?? []}
        entityId="orva_finance:ap_bill"
        perspective={{ tableId: 'orva_finance.ap.bills.list' }}
        rowActions={(row) => (
          <RowActions
            items={row.status === 'draft' ? [
              {
                label: t('orva_finance.ap.actions.post', 'Post'),
                onSelect: async () => {
                  const confirmed = await confirm({
                    title: t('orva_finance.ap.confirmPost', 'Post this bill? A GL journal will be booked and the bill becomes immutable.'),
                  })
                  if (!confirmed) return
                  await readApiResultOrThrow('/api/orva_finance/ap/bills/post', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ id: row.id }),
                  })
                  flash(t('orva_finance.ap.flash.posted', 'Bill posted to the ledger'), 'success')
                  queryClient.invalidateQueries({ queryKey: ['orva_finance.ap.bills'] })
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
