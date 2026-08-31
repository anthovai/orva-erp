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

type PaymentRow = {
  id: string
  payment_no?: string | null
  status: string
  vendor_party_id: string
  payment_date: string
  total_amount?: string | number
}

type PartyRow = { id: string; display_name: string }

export default function PaymentsTable() {
  const t = useT()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const scopeVersion = useOrganizationScopeVersion()
  const [page, setPage] = React.useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['orva_finance.ap.payments', page, scopeVersion],
    queryFn: async () =>
      fetchCrudList<PaymentRow>('orva_finance/ap/payments', {
        page, pageSize: 50, sortField: 'created_at', sortDir: 'desc',
      }),
  })

  const vendorIds = React.useMemo(
    () => Array.from(new Set((data?.items ?? []).map((p) => p.vendor_party_id))),
    [data?.items],
  )
  const { data: vendorsData } = useQuery({
    queryKey: ['orva_finance.ap.payment-vendors', vendorIds.join(','), scopeVersion],
    queryFn: async () => fetchCrudList<PartyRow>('orva_party/parties', { ids: vendorIds.join(','), pageSize: 100 }),
    enabled: vendorIds.length > 0,
  })
  const vendorMap = React.useMemo(() => {
    const map: Record<string, string> = {}
    for (const v of vendorsData?.items ?? []) map[v.id] = v.display_name
    return map
  }, [vendorsData?.items])

  const fmt = (v: string | number | undefined) =>
    Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const columns: ColumnDef<PaymentRow>[] = React.useMemo(() => [
    { accessorKey: 'payment_no', header: t('orva_finance.payments.column.no', 'Payment #'), meta: { priority: 1 } },
    {
      accessorKey: 'vendor_party_id',
      header: t('orva_finance.ap.column.vendor', 'Vendor'),
      enableSorting: false,
      meta: { priority: 1 },
      cell: ({ getValue }) => vendorMap[String(getValue())] ?? '…',
    },
    { accessorKey: 'payment_date', header: t('orva_finance.ap.column.date', 'Date'), meta: { priority: 2 } },
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
  ], [t, vendorMap])

  return (
    <>
      <DataTable
        title={t('orva_finance.payments.page.title', 'Vendor Payments')}
        emptyState={(
          <OrvaEmptyState
            title={t('orva_finance.payments.empty.title', "No payments yet")}
            description={t('orva_finance.payments.empty.description', "Pay an open vendor bill to settle it against your cash account.")}
          />
        )}
        actions={(
          <Button asChild>
            <Link href="/backend/ap/payments/create">{t('orva_finance.payments.actions.create', 'Create payment')}</Link>
          </Button>
        )}
        columns={columns}
        data={data?.items ?? []}
        entityId="orva_finance:ap_payment"
        perspective={{ tableId: 'orva_finance.ap.payments.list' }}
        rowActions={(row) => (
          <RowActions
            items={row.status === 'draft' ? [
              {
                label: t('orva_finance.payments.actions.post', 'Post'),
                onSelect: async () => {
                  const confirmed = await confirm({
                    title: t('orva_finance.payments.confirmPost', 'Post this payment? Bills will be settled and the payment becomes immutable.'),
                  })
                  if (!confirmed) return
                  await readApiResultOrThrow('/api/orva_finance/ap/payments/post', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ id: row.id }),
                  })
                  flash(t('orva_finance.payments.flash.posted', 'Payment posted'), 'success')
                  queryClient.invalidateQueries({ queryKey: ['orva_finance.ap.payments'] })
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
