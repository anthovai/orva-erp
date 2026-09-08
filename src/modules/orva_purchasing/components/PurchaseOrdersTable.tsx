"use client"
import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { OrvaEmptyState } from '@/components/orva/NodeMark'
import { selectClass } from './pickers'

type OrderRow = {
  id: string
  poNumber: string | null
  status: string
  vendorPartyId: string
  vendorName: string
  orderDate: string
  expectedOn: string | null
  subtotal: string
  taxAmount: string
  totalAmount: string
  memo: string | null
  vendorReference: string | null
  lineCount: number
  lateCount: number
  updatedAt: string
}

type ListResponse = {
  items: OrderRow[]
  total: number
  counts: { draft: number; sent: number; late: number; committed: string }
}

const money = (value: string | number) =>
  Number(value).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Status colour comes from the semantic scale, never a hard-coded palette. */
const STATUS_VARIANT: Record<string, StatusBadgeVariant> = {
  draft: 'neutral',
  sent: 'info',
  partially_received: 'warning',
  received: 'success',
  closed: 'neutral',
  cancelled: 'error',
}

/**
 * ใบสั่งซื้อ — what has been promised to whom, and what is late.
 *
 * The queue answers one question first: is anything overdue that nobody has
 * chased. So late orders are counted in the header and filterable in one
 * click, and a draft sorts above everything because a draft is a decision the
 * owner has not finished making.
 */
export default function PurchaseOrdersTable() {
  const t = useT()
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [bucket, setBucket] = React.useState<'open' | 'all'>('open')
  const [status, setStatus] = React.useState('')
  const [late, setLate] = React.useState(false)
  const [search, setSearch] = React.useState('')

  const list = useQuery({
    queryKey: ['orva_purchasing.orders', bucket, status, late, search, scopeVersion],
    queryFn: () => {
      const params = new URLSearchParams({ bucket })
      if (status) params.set('status', status)
      if (late) params.set('late', '1')
      if (search) params.set('search', search)
      return readApiResultOrThrow<ListResponse>(`/api/orva_purchasing/orders?${params}`)
    },
  })

  const remove = async (row: OrderRow) => {
    const confirmed = await confirm({
      title: t('orva_purchasing.confirmDelete', 'ลบฉบับร่างนี้?'),
    })
    if (!confirmed) return
    try {
      const res = await apiCall(`/api/orva_purchasing/orders?id=${row.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((res.result as { error?: string } | undefined)?.error ?? 'failed')
      flash(t('orva_purchasing.deleted', 'ลบฉบับร่างแล้ว'), 'success')
      await queryClient.invalidateQueries({ queryKey: ['orva_purchasing.orders'] })
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const columns: ColumnDef<OrderRow>[] = React.useMemo(
    () => [
      {
        accessorKey: 'poNumber',
        header: t('orva_purchasing.column.number', 'เลขที่'),
        meta: { priority: 1 },
        cell: ({ row }) => (
          <Link className="font-medium text-primary hover:underline" href={`/backend/purchasing/orders/${row.original.id}`}>
            {row.original.poNumber ?? t('orva_purchasing.status.draft', 'ฉบับร่าง')}
          </Link>
        ),
      },
      { accessorKey: 'vendorName', header: t('orva_purchasing.column.vendor', 'ผู้ขาย'), meta: { priority: 1 } },
      { accessorKey: 'orderDate', header: t('orva_purchasing.column.orderDate', 'วันที่สั่ง'), meta: { priority: 2 } },
      {
        accessorKey: 'expectedOn',
        header: t('orva_purchasing.column.expectedOn', 'คาดว่าได้รับ'),
        meta: { priority: 2 },
        cell: ({ row }) => (
          <span className={row.original.lateCount > 0 ? 'text-status-warning-fg' : undefined}>
            {row.original.expectedOn ?? '—'}
            {row.original.lateCount > 0
              ? ` · ${t('orva_purchasing.column.lateLines', 'เกินกำหนด {n} รายการ').replace('{n}', String(row.original.lateCount))}`
              : ''}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: t('orva_purchasing.column.status', 'สถานะ'),
        meta: { priority: 1 },
        cell: ({ row }) => (
          <StatusBadge variant={STATUS_VARIANT[row.original.status] ?? 'neutral'}>
            {t(`orva_purchasing.status.${row.original.status}`, row.original.status)}
          </StatusBadge>
        ),
      },
      {
        accessorKey: 'totalAmount',
        header: t('orva_purchasing.column.total', 'รวมทั้งสิ้น'),
        meta: { priority: 2 },
        cell: ({ getValue }) => <span className="tabular-nums">{money(getValue() as string)}</span>,
      },
    ],
    [t],
  )

  const counts = list.data?.counts

  return (
    <Page>
      <PageHeader
        title={t('orva_purchasing.page.title', 'ใบสั่งซื้อ')}
        description={t(
          'orva_purchasing.page.description',
          'สิ่งที่สั่งไปแล้วแต่ยังไม่มาและยังไม่มีบิล — ฉบับร่างยังแก้ได้ ใบที่ส่งแล้วล็อกราคาไว้',
        )}
      />
      <PageBody>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-muted-foreground">{t('orva_purchasing.filter.bucket', 'ช่วงที่ดู')}</span>
              <select className={selectClass} value={bucket} onChange={(event) => setBucket(event.target.value as 'open' | 'all')}>
                <option value="open">{t('orva_purchasing.filter.open', 'ที่ยังไม่ปิด')}</option>
                <option value="all">{t('orva_purchasing.filter.all', 'ทั้งหมด')}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-muted-foreground">{t('orva_purchasing.column.status', 'สถานะ')}</span>
              <select className={selectClass} value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">{t('orva_purchasing.filter.anyStatus', 'ทุกสถานะ')}</option>
                {['draft', 'sent', 'partially_received', 'received', 'closed', 'cancelled'].map((value) => (
                  <option key={value} value={value}>
                    {t(`orva_purchasing.status.${value}`, value)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-muted-foreground">{t('orva_purchasing.filter.search', 'ค้นหา')}</span>
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('orva_purchasing.filter.searchPlaceholder', 'เลขที่ / ผู้ขาย / หมายเหตุ')}
              />
            </label>
            <Button type="button" variant={late ? 'default' : 'outline'} size="sm" onClick={() => setLate((value) => !value)}>
              {t('orva_purchasing.filter.late', 'เฉพาะที่เกินกำหนด')}
              {counts && counts.late > 0 ? ` (${counts.late})` : ''}
            </Button>
          </div>

          {counts ? (
            <p className="text-xs text-muted-foreground">
              {t('orva_purchasing.summary.committed', 'ผูกพันแล้ว (ก่อน VAT): {amount} บาท').replace(
                '{amount}',
                money(counts.committed),
              )}
            </p>
          ) : null}

          <DataTable
            columns={columns}
            data={list.data?.items ?? []}
            entityId="orva_purchasing:purchase_order"
            perspective={{ tableId: 'orva_purchasing.orders.list' }}
            isLoading={list.isLoading}
            actions={
              <Button asChild>
                <Link href="/backend/purchasing/orders/create">{t('orva_purchasing.actions.create', 'สร้างใบสั่งซื้อ')}</Link>
              </Button>
            }
            emptyState={
              <OrvaEmptyState
                title={t('orva_purchasing.empty.title', 'ยังไม่มีใบสั่งซื้อ')}
                description={t(
                  'orva_purchasing.empty.description',
                  'สั่งของหรือบริการจากผู้ขายครั้งแรกได้จากปุ่มด้านขวา — จะได้เห็นว่าสั่งอะไรไว้ ของมาแล้วเท่าไร และบิลมาครบหรือยัง',
                )}
                action={
                  <Button asChild>
                    <Link href="/backend/purchasing/orders/create">
                      {t('orva_purchasing.actions.create', 'สร้างใบสั่งซื้อ')}
                    </Link>
                  </Button>
                }
              />
            }
            rowActions={(row) => (
              <RowActions
                items={[
                  {
                    id: 'open',
                    label: t('orva_purchasing.actions.open', 'เปิดดู'),
                    href: `/backend/purchasing/orders/${row.id}`,
                  },
                  {
                    id: 'print',
                    label: t('orva_purchasing.actions.print', 'พิมพ์ / ส่งอีเมล'),
                    href: `/backend/documents/preview?type=purchase_order&documentId=${row.id}`,
                  },
                  ...(row.status === 'draft'
                    ? [
                        {
                          id: 'delete',
                          label: t('orva_purchasing.actions.delete', 'ลบฉบับร่าง'),
                          destructive: true,
                          onSelect: () => remove(row),
                        },
                      ]
                    : []),
                ]}
              />
            )}
          />
        </div>
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
